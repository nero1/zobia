import type { NextPageContext } from "next";

/**
 * This app is App Router only (see app/not-found.tsx and
 * app/global-error.tsx, which handle every real 404/500 a visitor hits).
 * Next.js still always compiles a legacy Pages Router fallback bundle for
 * /404 and /500 internally, even in an App-Router-only project, and that
 * auto-generated fallback fails to statically prerender once the crypto
 * wallet-connect dependency tree (wagmi and its transitive deps) is
 * installed — its compiled `next/dist/shared/lib/head.js` throws
 * "Cannot read properties of null (reading 'useContext')" during
 * `next build`'s static-generation pass, independent of anything in our own
 * code (reproduces with wagmi alone, no application code touching it).
 *
 * Supplying our own minimal pages/_error.tsx replaces that broken
 * auto-generated bundle with this trivial one, which prerenders fine. It is
 * never actually served to a real visitor — the App Router's own
 * not-found.tsx / global-error.tsx intercept every request first — this
 * file exists purely so `next build` has something valid to compile instead
 * of the broken internal default.
 */
function Error({ statusCode }: { statusCode?: number }) {
  return (
    <p>{statusCode ? `An error ${statusCode} occurred.` : "An error occurred."}</p>
  );
}

Error.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
