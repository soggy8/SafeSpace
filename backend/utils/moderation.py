from __future__ import annotations

from typing import Any, Dict, List, Set


class ModerationError(RuntimeError):
    """Raised when the moderation service fails."""


KEYWORD_CATEGORIES: Dict[str, List[str]] = {
    "self-harm": [
        "kill myself",
        "suicide",
        "hurt myself",
        "end my life",
        "self harm",
        "cut myself",
        "i want to die",
    ],
    "violence": [
        "kill you",
        "kill them",
        "build a bomb",
        "make a bomb",
        "shoot up",
        "murder",
        "stab you",
        "beat you",
        "burn down",
    ],
    "hate": [
        "hate crime",
        "genocide",
        "racial slur",
        "kill all",
        "lynch",
        "deport them",
        "inferior race",
    ],
    "profanity": [
        "fuck you",
        "shithead",
        "motherfucker",
        "bastard",
        "asshole",
        "bitch",
        "dickhead",
        "cunt",
        "son of a bitch",
        "slut",
        "whore",
    ],
    "sexual": [
        "sexual assault",
        "rape",
        "child porn",
        "grooming",
        "explicit sex",
        "force you",
    ],
    "harassment": [
        "i will find you",
        "dox you",
        "i will ruin you",
        "stalk you",
        "keep calling you",
        "harass you",
    ],
    "drugs": [
        "sell drugs",
        "cocaine",
        "heroin",
        "meth lab",
        "cook meth",
        "buy weed",
    ],
    "weapons": [
        "buy a gun",
        "illegal gun",
        "assault rifle",
        "ghost gun",
        "buy explosives",
        "weapon cache",
    ],
    "terrorism": [
        "join isis",
        "terror attack",
        "blow up",
        "jihad attack",
        "martyr mission",
    ],
    "bullying": [
        "kill yourself",
        "nobody likes you",
        "you should die",
        "loser forever",
        "go die",
    ],
}


def _normalize(text: str) -> str:
    return (text or "").strip().lower()


def _find_matches(normalized_text: str) -> Set[str]:
    matches: Set[str] = set()
    for category, keywords in KEYWORD_CATEGORIES.items():
        if any(keyword in normalized_text for keyword in keywords):
            matches.add(category)
    return matches


def check_message_safety(text: str) -> Dict[str, Any]:
    """Check the provided text using keyword matching."""
    normalized = _normalize(text)
    if not normalized:
        return {
            "flagged": False,
            "categories": {category: False for category in KEYWORD_CATEGORIES},
        }

    matches = _find_matches(normalized)
    return {
        "flagged": bool(matches),
        "categories": {
            category: category in matches for category in KEYWORD_CATEGORIES
        },
    }
