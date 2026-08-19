import { Link } from "react-router-dom";

import { BRAND } from "../lib/brand";
import { env } from "../lib/env";

/** stonkpad footer — a single quiet line, in keeping with the pro-trading UI. */
export function BaseFooter() {
  return (
    <footer className="hlf">
      <div className="hlf-inner">
        <span className="hlf-mark">{BRAND.name}<span className="hlf-tld">{BRAND.tld}</span></span>
        <span className="hlf-tag">{BRAND.tagline}</span>
        <div className="hlf-spacer" />
        <nav className="hlf-links" aria-label="Footer">
          <Link to="/docs">Docs</Link>
          <a href={BRAND.twitter} target="_blank" rel="noreferrer">X</a>
          {env.explorerUrl && <a href={env.explorerUrl} target="_blank" rel="noreferrer">Explorer</a>}
        </nav>
      </div>
    </footer>
  );
}
