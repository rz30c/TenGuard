/*
 * TnofTn HD Ultimate – Vencord Plugin
 * Full stealth auto-return + anti-kick/disconnect
 */

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { ChannelStore, RestAPI, UserStore } from "@webpack/common";

interface VoiceState {
    userId: string;
    channelId?: string | null;
}

const settings = definePluginSettings({
    enabled: { type: OptionType.BOOLEAN, description: "تشغيل البلوقن", default: true },
    autoReturn: { type: OptionType.BOOLEAN, description: "الرجوع التلقائي للروم", default: true },
    ignoreUserId: { type: OptionType.STRING, description: "Ignore User ID (اختياري)", default: "" }
});

let myId: string | null = null;
let lastChannelId: string | null = null;
let loopTimer: NodeJS.Timeout | null = null;

function startReturnLoop(guildId: string, channelId: string) {
    if (loopTimer) return;
    loopTimer = setInterval(() => {
        if (!myId) return;
        RestAPI.patch({
            url: `/guilds/${guildId}/members/${myId}`,
            body: { channel_id: channelId }
        }).catch(() => {});
    }, 500); // كل نص ثانية يحاول يرجعك
}

function stopReturnLoop() {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = null;
}

export default definePlugin({
    name: "TnofTn",
    description: "Ultimate stealth HD auto-return + anti-kick/disconnect",
    authors: [{ name: "10" }],
    settings,

    start() { myId = UserStore.getCurrentUser()?.id ?? null; },

    stop() { stopReturnLoop(); lastChannelId = null; },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            if (!settings.store.enabled || !settings.store.autoReturn || !myId) return;

            for (const state of voiceStates) {
                if (state.userId !== myId) continue;

                if (state.channelId) { lastChannelId = state.channelId; stopReturnLoop(); return; }

                if (!state.channelId && lastChannelId) {
                    const channel = ChannelStore.getChannel(lastChannelId);
                    const guildId = (channel as any)?.guild_id ?? (channel as any)?.guildId;
                    if (!guildId) return;
                    startReturnLoop(guildId, lastChannelId);
                }
            }
        }
    }
});
