# Mobile Rollout Risk Log (Flutter Sprint)

## Known Risks / Follow-ups
- The login, legal, and quiz routes intentionally retain their existing desktop-oriented shells/flows; they still need dedicated mobile smoke checks once e2e coverage is extended.
- Dashboard/wardrobe item cards and some non-primary CTA states may still use dense spacing at extremely small widths (<320px); this should be validated against real device CSS breakpoints.
- A full end-to-end verification pass (especially iOS Safari viewport + keyboard behavior) is still required before release because runtime-only regressions are not covered by the current unit test set.
- Accessibility polish for a few icon-only controls (not all newly added labels have explicit `title`/`aria-label` in downstream subcomponents) should be reviewed in a11y tooling.
