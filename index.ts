/*
 * 10 Guard - Vencord Plugin
 * Auto return to voice + detect who moved you
 */

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findStoreLazy } from "@webpack";
import { RestAPI, UserStore } from "@webpack/common";

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
}

interface VoiceStateStore {
    getAllVoiceStates(): Record<string, Record<string, VoiceState>>;
}

const VoiceStateStore: VoiceStateStore = findStoreLazy("VoiceStateStore");

// ===== Settings =====
const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable / Disable 10 Guard",
        default: true
    },
    message: {
        type: OptionType.STRING,
        description: "Message sent to the user who tries to move you",
        default: "😂 Nice try — 10 Guard returned me instantly."
    }
});

let lastChannelId: string | null = null;
let myId: string | null = null;

function getMyChannel(): string | null {
    if (!myId) return null;

    const states = VoiceStateStore.getAllVoiceStates();
    for (const guild of Object.values(states)) {
        if (guild[myId]?.channelId) {
            return guild[myId].channelId!;
        }
    }
    return null;
}

function sendDM(userId: string, content: string) {
    RestAPI.post({
        url: "/users/@me/channels",
        body: { recipient_id: userId }
    })
        .then((res: any) => {
            RestAPI.post({
                url: `/channels/${res.body.id}/messages`,
                body: { content }
            });
        })
        .catch(() => {});
}

export default definePlugin({
    name: "10 Guard",
    description: "Auto return to voice channel and notify who tried to move you",
    authors: [{ name: "10" }],
    settings,

    start() {
        myId = UserStore.getCurrentUser()?.id ?? null;
        lastChannelId = getMyChannel();
        console.log("[10 Guard] Enabled 🛡️");
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            if (!settings.store.enabled) return;
            if (!myId) return;

            for (const state of voiceStates) {

                // أنت
                if (state.userId === myId) {
                    if (state.channelId) {
                        lastChannelId = state.channelId;
                    } else if (!state.channelId && lastChannelId) {
                        const guilds = VoiceStateStore.getAllVoiceStates();

                        for (const [guildId] of Object.entries(guilds)) {
                            RestAPI.patch({
                                url: `/guilds/${guildId}/members/${myId}`,
                                body: { channel_id: lastChannelId }
                            }).catch(() => {});
                        }
                    }
                }

                // الشخص اللي حاول يسحبك
                if (
                    state.userId !== myId &&
                    state.oldChannelId === lastChannelId &&
                    !state.channelId
                ) {
                    sendDM(state.userId, settings.store.message);
                }
            }
        }
    },

    stop() {
        console.log("[10 Guard] Disabled ❌");
        lastChannelId = null;
        myId = null;
    }
});
