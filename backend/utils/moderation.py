"""Simple keyword-based moderation helpers used by the backend and extension."""

from __future__ import annotations

from typing import Any, Dict, List, Set


class ModerationError(RuntimeError):
    """Raised when the moderation service fails."""


# Buckets of phrases that map directly to content categories. The extension
# fetches these so client-side blurring stays in sync with the backend.
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
    """Prepare text for keyword matching (trim + lowercase)."""
    return (text or "").strip().lower()


def _find_matches(normalized_text: str) -> Set[str]:
    """Return the set of categories that match a given text snippet."""
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


def get_all_keywords() -> List[str]:
    """Return a sorted list of unique keywords used for moderation."""
    unique_keywords: Set[str] = set()
    for keywords in KEYWORD_CATEGORIES.values():
        for keyword in keywords:
            normalized = keyword.strip().lower()
            if normalized:
                unique_keywords.add(normalized)
    return sorted(unique_keywords)
