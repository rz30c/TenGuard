/*
 * TenGuard – Vencord Plugin
 * Auto return to voice + detect mover + notify & DM
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findStoreLazy } from "@webpack";
import { ChannelStore, RestAPI, Toasts, UserStore } from "@webpack/common";

interface VoiceState {
    userId: string;
    channelId?: string | null;
    oldChannelId?: string | null;
}

const VoiceStateStore = findStoreLazy("VoiceStateStore");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable TenGuard",
        default: true
    },
    autoReturn: {
        type: OptionType.BOOLEAN,
        description: "Auto return to your last voice channel",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show notification when someone moves you",
        default: true
    },
    dmMover: {
        type: OptionType.BOOLEAN,
        description: "Send DM to the person who moved you",
        default: true
    },
    message: {
        type: OptionType.STRING,
        description: "DM message sent to the mover",
        default: "😂 Nice try — TenGuard returned me instantly."
    }
});

let lastChannelId: string | null = null;
let myId: string | null = null;

async function sendDM(userId: string, content: string) {
    try {
        const dm = await RestAPI.post({
            url: "/users/@me/channels",
            body: { recipient_id: userId }
        }) as any;

        const dmId = dm?.body?.id;
        if (!dmId) return;

        await RestAPI.post({
            url: `/channels/${dmId}/messages`,
            body: { content }
        });
    } catch {
        // ignore
    }
}

async function findMoverAndNotify(
    guildId: string,
    victimId: string,
    previousChannelId: string
) {
    try {
        const res = await RestAPI.get({
            url: `/guilds/${guildId}/audit-logs`,
            query: {
                limit: 10,
                action_type: 24 // MEMBER_MOVE
            }
        }) as any;

        const entries: any[] =
            res?.body?.audit_log_entries ??
            res?.body?.auditLogEntries ??
            [];

        const entry = entries.find(e => String(e.target_id) === String(victimId));
        if (!entry) return;

        const moverId = entry.user_id;
        if (!moverId) return;

        const mover = UserStore.getUser(moverId);
        const channel = ChannelStore.getChannel(previousChannelId);

        if (settings.store.notify) {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.INFO,
                message: `TenGuard: ${mover?.username ?? moverId} tried to move you from ${channel?.name ?? "voice channel"}.`
            });
        }

        if (settings.store.dmMover) {
            await sendDM(moverId, settings.store.message);
        }
    } catch {
        // no permission / rate limit
    }
}

export default definePlugin({
    name: "TenGuard",
    description: "Auto return to voice, detect who moved you, notify & DM them",
    authors: [{ name: "Ryan" }],
    settings,

    start() {
        myId = UserStore.getCurrentUser()?.id ?? null;
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            if (!settings.store.enabled) return;
            if (!myId) return;

            for (const state of voiceStates) {
                if (state.userId !== myId) continue;

                // Joined / moved normally
                if (state.channelId) {
                    lastChannelId = state.channelId;
                    continue;
                }

                // Removed / disconnected
                if (!state.channelId && lastChannelId && settings.store.autoReturn) {
                    const channel = ChannelStore.getChannel(lastChannelId);
                    const guildId =
                        (channel as any)?.guild_id ??
                        (channel as any)?.guildId;

                    if (!guildId) return;

                    // Instant return
                    RestAPI.patch({
                        url: `/guilds/${guildId}/members/${myId}`,
                        body: { channel_id: lastChannelId }
                    }).catch(() => {});

                    // Detect mover
                    void findMoverAndNotify(guildId, myId, lastChannelId);
                }
            }
        }
    }
});
