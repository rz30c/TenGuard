/*
 * TenGuard Ultimate – Vencord Plugin
 * Auto return + detect mover + ignore + settings
 */

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { ChannelStore, RestAPI, Toasts, UserStore } from "@webpack/common";

interface VoiceState {
    userId: string;
    channelId?: string | null;
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "تشغيل البلوقن",
        default: true
    },
    autoReturn: {
        type: OptionType.BOOLEAN,
        description: "الرجوع التلقائي للروم",
        default: true
    },
    showToast: {
        type: OptionType.BOOLEAN,
        description: "إظهار تنبيه",
        default: true
    },
    sendDM: {
        type: OptionType.BOOLEAN,
        description: "إرسال رسالة للي سحبك",
        default: true
    },
    message: {
        type: OptionType.STRING,
        description: "نص الرسالة",
        default: "😂 Nice try — TenGuard رجعني مباشرة."
    },
    ignoreUserId: {
        type: OptionType.STRING,
        description: "Ignore User ID (اختياري)",
        default: ""
    }
});

let myId: string | null = null;
let lastChannelId: string | null = null;
let loopTimer: NodeJS.Timeout | null = null;

function startReturnLoop(guildId: string, channelId: string) {
    if (loopTimer) return;

    let tries = 0;

    loopTimer = setInterval(() => {
        tries++;

        RestAPI.patch({
            url: `/guilds/${guildId}/members/${myId}`,
            body: { channel_id: channelId }
        }).catch(() => {});

        if (tries >= 20) stopReturnLoop(); // 10 ثواني
    }, 500);
}

function stopReturnLoop() {
    if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
    }
}

async function findMoverAndReact(
    guildId: string,
    victimId: string,
    channelId: string
) {
    try {
        const { body } = await RestAPI.get({
            url: `/guilds/${guildId}/audit-logs`,
            query: { limit: 10, action_type: 24 }
        } as any);

        const entries = body?.audit_log_entries ?? [];
        const entry = entries.find((e: any) =>
            String(e.target_id) === String(victimId)
        );

        if (!entry) return;

        const moverId = entry.user_id;
        if (!moverId) return;

        if (settings.store.ignoreUserId &&
            moverId === settings.store.ignoreUserId
        ) return;

        const mover = UserStore.getUser(moverId);
        const channel = ChannelStore.getChannel(channelId);

        if (settings.store.showToast) {
            Toasts.show({
                type: Toasts.Type.INFO,
                id: Toasts.genId(),
                message: `TenGuard: ${mover?.username ?? moverId} حاول يسحبك من ${channel?.name ?? "روم صوتي"}`
            });
        }

        if (settings.store.sendDM) {
            const dm = await RestAPI.post({
                url: "/users/@me/channels",
                body: { recipient_id: moverId }
            } as any);

            await RestAPI.post({
                url: `/channels/${dm.body.id}/messages`,
                body: { content: settings.store.message }
            });
        }
    } catch {
        // Ignore
    }
}

export default definePlugin({
    name: "TenGuardUltimate",
    description: "Ultimate anti-move voice guard",
    authors: [{ name: "Ryan" }],
    settings,

    start() {
        myId = UserStore.getCurrentUser()?.id ?? null;
    },

    stop() {
        stopReturnLoop();
        lastChannelId = null;
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            if (!settings.store.enabled) return;
            if (!settings.store.autoReturn) return;
            if (!myId) return;

            for (const state of voiceStates) {
                if (state.userId !== myId) continue;

                if (state.channelId) {
                    lastChannelId = state.channelId;
                    stopReturnLoop();
                    return;
                }

                if (!state.channelId && lastChannelId) {
                    const channel = ChannelStore.getChannel(lastChannelId);
                    const guildId =
                        (channel as any)?.guild_id ??
                        (channel as any)?.guildId;

                    if (!guildId) return;

                    startReturnLoop(guildId, lastChannelId);
                    void findMoverAndReact(guildId, myId, lastChannelId);
                }
            }
        }
    }
});
