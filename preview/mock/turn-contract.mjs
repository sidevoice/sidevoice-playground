// Independent #19 case oracle. Changing a fixture cannot change its required actions or outcome.
// This checks the reference model only; live acceptance needs the pinned producer stack.
export const TURN_CONTRACT = {
  "T01": {
    "actions": [
      "speech-start",
      "reply-playing",
      "speech-qualified",
      "turn-finished"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [
        "partial"
      ],
      "notice": [
        "reply_not_heard"
      ],
      "screen": [
        "cut"
      ]
    }
  },
  "T02a": {
    "actions": [
      "reply-accepted",
      "speech-start",
      "turn-finished"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [
        "not_heard"
      ],
      "notice": [
        "reply_not_heard"
      ],
      "screen": [
        "unheard"
      ]
    }
  },
  "T02b": {
    "actions": [
      "reply-accepted",
      "speech-start",
      "turn-cancelled"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [
        "not_heard"
      ],
      "notice": [
        "turn_empty"
      ],
      "screen": [
        "unheard"
      ]
    }
  },
  "T02c": {
    "actions": [
      "speech-start",
      "voice-say",
      "turn-finished"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [],
      "tool": "user_speaking",
      "screen": []
    }
  },
  "T02d": {
    "actions": [
      "speech-start",
      "voice-say",
      "turn-cancelled"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [],
      "tool": "user_speaking",
      "notice": [
        "turn_empty"
      ],
      "screen": []
    }
  },
  "T03": {
    "actions": [
      "speech-finished",
      "speech-finished",
      "late-reply"
    ],
    "outcome": {
      "epochDelta": 2,
      "fates": [
        "not_heard"
      ],
      "notice": [
        "reply_not_heard"
      ],
      "screen": [
        "unheard"
      ]
    }
  },
  "T04a": {
    "actions": [
      "speech-finished",
      "reply",
      "reply",
      "reply"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [
        "heard",
        "heard",
        "heard"
      ],
      "screen": [
        "all-three"
      ]
    }
  },
  "T04b": {
    "actions": [
      "reply-playing",
      "reply-queued",
      "reply-queued",
      "speech-start"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [
        "partial",
        "not_heard",
        "not_heard"
      ],
      "notice": [
        "reply_not_heard"
      ],
      "screen": [
        "unheard"
      ]
    }
  },
  "T05": {
    "actions": [
      "ack",
      "checkpoint",
      "speech-start",
      "result"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [
        "heard",
        "partial",
        "not_heard"
      ],
      "notice": [
        "reply_not_heard"
      ],
      "screen": [
        "checkpoint-cut"
      ]
    }
  },
  "T06a": {
    "actions": [
      "reply-playing",
      "agents-mute",
      "reply"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "partial",
        "not_heard"
      ],
      "screen": [
        "unheard"
      ]
    }
  },
  "T06b": {
    "actions": [
      "voice-off",
      "reply",
      "voice-on"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "not_heard"
      ],
      "screen": [
        "unheard"
      ]
    }
  },
  "T06c": {
    "actions": [
      "reply-playing",
      "focus-switch",
      "turn-finished"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "partial"
      ],
      "screen": [
        "inactive-conversation"
      ]
    }
  },
  "T06d": {
    "actions": [
      "agents-mute",
      "reply",
      "agents-unmute",
      "return-grace"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "not_heard"
      ],
      "notice": [
        "user_returned"
      ],
      "screen": [
        "unheard"
      ]
    }
  },
  "T06e": {
    "actions": [
      "reply-heard",
      "focus-switch",
      "focus-return"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "heard"
      ],
      "notice": [],
      "screen": [
        "heard"
      ]
    }
  },
  "T07": {
    "actions": [
      "reply-playing",
      "disconnect",
      "reconnect",
      "retry"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "unconfirmed"
      ],
      "notice": [],
      "screen": [
        "hearing-unconfirmed"
      ]
    }
  },
  "T08": {
    "actions": [
      "reply-playing",
      "typed-message",
      "reply-queued"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "heard",
        "heard"
      ],
      "screen": [
        "typed-context"
      ]
    }
  },
  "T09a": {
    "actions": [
      "reply-playing",
      "speech-990ms",
      "speech-low-volume"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "heard"
      ],
      "notice": [],
      "screen": [
        "no-cut"
      ]
    }
  },
  "T09b": {
    "actions": [
      "speech-short-silent"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [],
      "screen": [
        "user-message"
      ]
    }
  },
  "T10": {
    "actions": [
      "speaker-only-echo"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [],
      "notice": [],
      "screen": [
        "no-user-message"
      ]
    }
  },
  "T11": {
    "actions": [
      "conversation-a",
      "conversation-b",
      "duplicate-start",
      "out-of-order-finish"
    ],
    "outcome": {
      "epochDelta": 2,
      "fates": [],
      "screen": [
        "independent-conversations"
      ]
    }
  },
  "T12": {
    "actions": [
      "reply-playing",
      "skip",
      "next-reply"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "heard",
        "heard"
      ],
      "notice": [],
      "screen": [
        "heard"
      ]
    }
  },
  "T13": {
    "actions": [
      "speech-start",
      "mic-mute",
      "turn-finished"
    ],
    "outcome": {
      "epochDelta": 1,
      "fates": [],
      "screen": [
        "normal-turn-end"
      ]
    }
  },
  "T14": {
    "actions": [
      "reply-partial-device-a",
      "reply-heard-device-b",
      "switch-device"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [
        "heard"
      ],
      "screen": [
        "global-heard"
      ]
    }
  },
  "T15": {
    "actions": [
      "activity-2900ms",
      "activity-3000ms",
      "inactivity",
      "activity-restart"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [],
      "screen": [
        "hidden-before-3000",
        "shown-at-3000",
        "reset"
      ]
    }
  },
  "T16": {
    "actions": [
      "push-input",
      "pull-input",
      "ack-loss",
      "redelivery",
      "reconnect"
    ],
    "outcome": {
      "epochDelta": 0,
      "fates": [],
      "screen": [
        "stable-message-ids"
      ],
      "notice": [
        "same-in-push-and-pull"
      ]
    }
  }
};
