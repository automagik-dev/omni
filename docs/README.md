# Omni v2 Knowledge Base 🐙

> This folder is an **Obsidian vault**. Open it with [Obsidian](https://obsidian.md) for the best experience.

## Structure

```
docs/
├── api/                    # API design, endpoints, internal routes
├── architecture/           # System architecture (events, identity, plugins)
├── cli/                    # CLI design & commands
├── media/                  # Media processing pipeline
├── migration/              # v1 → v2 migration docs
├── performance/            # Load tests, baselines
├── research/               # 🔬 Research findings (Baileys, WhatsApp, anti-bot)
│   ├── baileys/            # Baileys protocol internals
│   ├── whatsapp-business/  # WhatsApp Business API & policies
│   ├── anti-bot/           # Meta anti-bot detection & evasion
│   └── omni-internals/     # Deep dives into Omni's own systems
├── sdk/                    # SDK generation & usage
├── templates/              # Note templates
├── ui/                     # Dashboard components
└── BAILEYS-JID-MENTIONS-GROUPS.md  # JID reference (legacy, moving to research/)
```

## Conventions

- **Wikilinks**: Use `[[Page Name]]` for internal links
- **Tags**: Use `#tag` inline — e.g. `#baileys`, `#api`, `#bug`, `#research`
- **Frontmatter**: Every doc should have YAML frontmatter with at least `title`, `updated`, `tags`
- **File naming**: `kebab-case.md`
- **Research notes**: Must include `source:` in frontmatter (URL or repo path)

## Maintained By

- **📜 Scroll** — Docs reviewer octopus, keeps docs in sync with code
- **🦑 Ink** — Baileys research
- **🐚 Pearl** — WhatsApp Business research
- **🪸 Coral** — Omni architecture research
- **🐙 Omni** — Engineering lead, final review
