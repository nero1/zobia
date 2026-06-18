/**
 * CSS module declarations for TypeScript 6+ compatibility.
 *
 * TypeScript 6 introduced TS2882, which requires type declarations for
 * side-effect CSS imports (e.g. `import './globals.css'`). This file
 * satisfies that requirement without changing Next.js's CSS handling.
 */
declare module '*.css' {}
