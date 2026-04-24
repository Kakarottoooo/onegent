/**
 * MDX renderer for /developers/docs/*. Reads a markdown file string
 * and compiles it via next-mdx-remote (server-side compile, ships
 * pre-built HTML to the client). Auto-generates heading IDs +
 * anchor links so the docs are linkable section-by-section.
 *
 * Code blocks ship without a syntax highlighter — keeps bundle
 * small + matches Mercury / Stripe Atlas's restraint. We can add
 * rehype-pretty-code later if a doc page demands it.
 */

import { MDXRemote } from "next-mdx-remote/rsc";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import remarkGfm from "remark-gfm";
import type { MDXComponents } from "mdx/types";

const components: MDXComponents = {
  h1: ({ children, ...props }) => (
    <h1 className="dev-doc-h1" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="dev-doc-h2" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="dev-doc-h3" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="dev-doc-p" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="dev-doc-list" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="dev-doc-list dev-doc-list--ordered" {...props}>
      {children}
    </ol>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="dev-doc-quote" {...props}>
      {children}
    </blockquote>
  ),
  code: ({ children, ...props }) => (
    <code className="dev-doc-code" {...props}>
      {children}
    </code>
  ),
  pre: ({ children, ...props }) => (
    <pre className="dev-doc-pre" {...props}>
      {children}
    </pre>
  ),
  a: ({ children, href, ...props }) => (
    <a
      className="dev-doc-link"
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noreferrer" : undefined}
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ children, ...props }) => (
    <div className="dev-doc-table-wrap">
      <table className="dev-doc-table" {...props}>
        {children}
      </table>
    </div>
  ),
  hr: () => <hr className="dev-doc-hr" />,
};

export function MdxContent({ source }: { source: string }) {
  return (
    <MDXRemote
      source={source}
      components={components}
      options={{
        mdxOptions: {
          remarkPlugins: [remarkGfm],
          rehypePlugins: [
            rehypeSlug,
            [
              rehypeAutolinkHeadings,
              {
                behavior: "append",
                properties: { className: ["dev-doc-anchor"], "aria-label": "Anchor link" },
                content: { type: "text", value: " #" },
              },
            ],
          ],
        },
      }}
    />
  );
}
