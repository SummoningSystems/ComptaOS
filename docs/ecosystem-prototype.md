# Ecosystem UX prototype

## Open

On develop, start the frontend from the repository root:

    npm run dev --prefix frontend -- --host 0.0.0.0

Open http://localhost:5173/?prototype=ecosystem on the server, or
http://YOUR_LAN_IP:5173/?prototype=ecosystem from another device.
This prototype needs only the frontend. No login or backend is required.
The regular application also offers a **Prototype écosystème** link.

This is the proposed ecosystem experience using the shared ComptaOS work area,
sidebar, tab bar and theme. It is a browser-only design prototype; the existing
business/household records and authentication are not changed.

## What to evaluate

1. **Structure**: select Commun · Charges. It should appear once, with both people
   listed as holders. Select a relation's other endpoint to inspect it.
2. **+ Ajouter**: create a person, company or bank account. Try an Épargne account.
3. **+ Relation**: attach two holders to that account. Ownership, professional use,
   and a person's activity are explicit, different relationships.
4. Rename an entity or change account usage in its inspector. Remove a relation
   with its × button. Map/list view, zoom and relation focus help with larger maps.
5. Open **Personnel · Augustin → Ouvrir les mouvements → Achat mixte · matériel**.
6. Open **Traitement · Studio Augustin**. The existing company navigation appears.
7. Return to earlier tabs: the selected node, period, search and simulated
   validation stay in their respective tabs. Select the other company and open
   its TVA placeholder: the first company's tab must retain its original scope.
8. In **Flux**, select a period and an arrow (or a row in Liste des flux). Open
   its bank movement. The source flow view should preserve its selection.
9. Try Ctrl+K, close/reorder tabs, or open a tab in another window.

## Prototype boundaries

- Structure edits persist under the localStorage key comptaos-ecosystem-ux-v1.
  They are specific to the browser/origin, and are not shared between users/devices.
- Tabs and their selections/filters last for the current page session.
  Reloading starts from the structure; a popped-out tab keeps its scoped route.
- **Réinitialiser** restores the fictional two-person, two-company, six-account
  example after confirmation. More people, companies and accounts can be added.
- Movements are a fixed illustrative dataset for August and September 2026.
  Newly created accounts have no sample transactions.
- Flow amounts come from that dataset; each depicted transfer is one movement.
  Lines show direction and type, not proportional amounts. The inspector/list
  provides exact amounts. The graph includes only accounts with sample movements.
- Detailed accounting, documents, VAT, budgets and other tools are placeholders.
  A simulated validation is local to that tab, with no journal or financial writes.
- Existing entreprises are not yet attached to this prototype's example ecosystem.
- Shared accounting data, reconciliation, permissions, bank connections and
  migration are future integration work after validating the UX.

## Checks

    npm run build --prefix frontend
    npm run lint --prefix frontend
    npx playwright test --config playwright.ecosystem.config.ts

The browser checks use their own frontend on port 5175, no backend. They verify
dynamic joint ownership, browser persistence, scoped navigation, filter retention,
flow drill-down and the absence of financial API requests. Screenshots are written
under .artifacts/ecosystem (ignored by Git).


## Structure layouts and company hierarchies

In Structure, **Disposition** offers:
- **Colonnes**: people, companies and bank accounts.
- **Libre**: drag nodes; arrow keys move the focused node, Shift increases the step.
  Positions are saved independently of automatic layouts, including across reloads.
- **Hiérarchie**: parent companies above their participations, with each entity shown once.
  Multiple parents are supported; hierarchy cycles are rejected in this prototype.

Use the zoom selector and scrollbars to navigate the diagram.
When adding/editing a company, choose Entreprise, Holding, SCI or Autre.
In **+ Relation**, choose **Entreprise → participation dans une entreprise**,
then the parent under De and the held company under Vers. The inspector shows
Entreprise mère / Participation détenue, and arrows point from parent to child.

These labels describe the structure only. They do not add legal/tax calculations,
ownership percentages, or consolidated company accounting to the sample screens.
Existing prototype data is retained when this update adds position/layout settings.
