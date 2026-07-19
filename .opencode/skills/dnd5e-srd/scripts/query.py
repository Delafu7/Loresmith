#!/usr/bin/env python3
"""
Query the D&D 5e SRD dataset (OGL/CC-BY licensed) without loading the full
JSON files into the agent's context. Supports both rules editions.

Usage:
    python3 query.py <edition> <category> <search term>
    python3 query.py <edition> <category> --list
    python3 query.py --categories

Editions: 2014 (SRD 5.1, OGL 1.0a) or 2024 (SRD 5.2, CC-BY-4.0)

Note: this skill deliberately does NOT include the spells, monsters,
equipment, or magic-items catalogs (specific damage/prices/stat blocks) -
it only covers the general rules framework. Store your own spells,
weapons, and character sheets in your app's own data layer.

Examples:
    python3 query.py 2014 classes wizard
    python3 query.py 2014 levels wizard-5
    python3 query.py 2024 classes wizard
    python3 query.py 2024 species elf
    python3 query.py 2014 races elf
    python3 query.py 2024 feats --list
"""
import json
import sys
import os
import difflib

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

CATEGORY_FILES = {
    "2014": {
        "ability-scores": "5e-SRD-Ability-Scores.json",
        "alignments": "5e-SRD-Alignments.json",
        "backgrounds": "5e-SRD-Backgrounds.json",
        "classes": "5e-SRD-Classes.json",
        "conditions": "5e-SRD-Conditions.json",
        "damage-types": "5e-SRD-Damage-Types.json",
        "feats": "5e-SRD-Feats.json",
        "features": "5e-SRD-Features.json",
        "languages": "5e-SRD-Languages.json",
        "levels": "5e-SRD-Levels.json",
        "magic-schools": "5e-SRD-Magic-Schools.json",
        "proficiencies": "5e-SRD-Proficiencies.json",
        "races": "5e-SRD-Races.json",
        "rule-sections": "5e-SRD-Rule-Sections.json",
        "rules": "5e-SRD-Rules.json",
        "skills": "5e-SRD-Skills.json",
        "subclasses": "5e-SRD-Subclasses.json",
        "subraces": "5e-SRD-Subraces.json",
        "traits": "5e-SRD-Traits.json",
        "weapon-properties": "5e-SRD-Weapon-Properties.json",
    },
    "2024": {
        "ability-scores": "5e-SRD-Ability-Scores.json",
        "alignments": "5e-SRD-Alignments.json",
        "backgrounds": "5e-SRD-Backgrounds.json",
        "classes": "5e-SRD-Classes.json",
        "conditions": "5e-SRD-Conditions.json",
        "damage-types": "5e-SRD-Damage-Types.json",
        "feats": "5e-SRD-Feats.json",
        "features": "5e-SRD-Features.json",
        "languages": "5e-SRD-Languages.json",
        "levels": "5e-SRD-Levels.json",
        "magic-schools": "5e-SRD-Magic-Schools.json",
        "proficiencies": "5e-SRD-Proficiencies.json",
        "species": "5e-SRD-Species.json",
        "subspecies": "5e-SRD-Subspecies.json",
        "skills": "5e-SRD-Skills.json",
        "subclasses": "5e-SRD-Subclasses.json",
        "traits": "5e-SRD-Traits.json",
        "weapon-properties": "5e-SRD-Weapon-Properties.json",
        "weapon-mastery-properties": "5e-SRD-Weapon-Mastery-Properties.json",
    },
}


def load(edition, category):
    path = os.path.join(DATA_DIR, edition, CATEGORY_FILES[edition][category])
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    if args[0] == "--categories":
        for ed in CATEGORY_FILES:
            print(f"{ed}: {', '.join(sorted(CATEGORY_FILES[ed]))}")
        return

    if len(args) < 2:
        print("Usage: python3 query.py <edition: 2014|2024> <category> [search term]")
        sys.exit(1)

    edition, category = args[0], args[1]
    if edition not in CATEGORY_FILES:
        print(f"Unknown edition: {edition} (use 2014 or 2024)")
        sys.exit(1)
    if category not in CATEGORY_FILES[edition]:
        print(f"Unknown category '{category}' for edition {edition}.")
        print(f"Available: {', '.join(sorted(CATEGORY_FILES[edition]))}")
        sys.exit(1)

    items = load(edition, category)

    if len(args) > 2 and args[2] == "--list":
        for it in items:
            print(it.get("index", it.get("name")))
        return

    if len(args) < 3:
        print(f"{len(items)} items in '{edition}/{category}'. Use --list to see them, or pass a search term.")
        return

    query = " ".join(args[2:]).lower()

    exact = [it for it in items if it.get("index", "").lower() == query
             or it.get("name", "").lower() == query]
    if exact:
        print(json.dumps(exact[0], indent=2, ensure_ascii=False))
        return

    partial = [it for it in items if query in it.get("name", "").lower()
               or query in it.get("index", "").lower()]
    if len(partial) == 1:
        print(json.dumps(partial[0], indent=2, ensure_ascii=False))
        return
    if partial:
        print(f"{len(partial)} matches for '{query}':")
        for it in partial:
            print(" -", it.get("name"), f"({it.get('index')})")
        return

    names = [it.get("name", "") for it in items]
    close = difflib.get_close_matches(query, names, n=5, cutoff=0.5)
    if close:
        print(f"No exact matches for '{query}'. Did you mean:")
        for c in close:
            print(" -", c)
    else:
        print(f"No results for '{query}' in '{edition}/{category}'.")


if __name__ == "__main__":
    main()
