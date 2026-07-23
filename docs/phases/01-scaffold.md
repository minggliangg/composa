# Phase 01 — Scaffold

## Goal

Create the static, runnable application shell on which the editor will be built.

## Work to complete

- Initialize the repository and a Vite React + TypeScript application.
- Add Tailwind CSS and its build configuration.
- Create the agreed source layout, including placeholder modules for canvas, panels, state, upload, export, and WASM boundaries.
- Implement a responsive static shell: top bar above left panel, center canvas region, and right panel.
- Add npm scripts for development and production build. The WASM build hook may be a documented placeholder until Phase 07, but it must not make the Phase 01 application unusable.
- Add the testing tool configuration needed for later Vitest and Playwright work.

## Definition of done

- A fresh dependency install can start the app and produce a production build.
- The browser displays the three-panel editor structure and a top bar without runtime errors.
- TypeScript, styling, and component boundaries match the project structure in the implementation plan; no image-editor behavior is implied yet.

## Verifiable evidence

- `npm run build` exits successfully.
- The development server starts with `npm run dev` and serves the application.
- A source inspection shows separate TopBar, left-panel, canvas, and right-panel entry components rather than one monolithic page.

## Manual check

Run `npm run dev`, open the printed localhost URL, and resize the browser: the top bar and the three editor regions should remain visibly distinct with no console error.
