import { useEffect, useState } from "react";
import { api, ErrorNote } from "./study";
type Resource = {
  title: string;
  url: string;
  kind: "folder" | "paper" | "audio" | "answers" | "transcript";
};
export default function Resources() {
  const [items, setItems] = useState<Resource[]>([]),
    [selected, setSelected] = useState<Resource | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api<{ items: Resource[] }>("resources")
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="study-panel source-papers">
      <p className="eyebrow">Your supplied sources · stored privately</p>
      <h2>The papers on your shelf.</h2>
      <ErrorNote error={error} />
      {items.length ? (
        <>
          <p>
            Read the supplied PDFs and use their accompanying audio, answers,
            and transcript. These reference files stay in Drive; they are not
            copied into the public source repository.
          </p>
          <div className="library-actions">
            {items.map((item) =>
              item.kind === "folder" ? (
                <a
                  key={item.url}
                  className="secondary"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title} ↗
                </a>
              ) : (
                <button
                  key={item.url}
                  className="secondary"
                  aria-pressed={selected?.url === item.url}
                  onClick={() => setSelected(item)}
                >
                  {item.title}
                </button>
              ),
            )}
          </div>
          {selected && (
            <>
              <div className="session-top">
                <h3>{selected.title}</h3>
                <a
                  href={selected.url.replace("/preview", "/view")}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Drive ↗
                </a>
              </div>
              <iframe
                className="paper-viewer"
                key={selected.url}
                title={selected.title}
                src={selected.url}
                sandbox="allow-scripts allow-same-origin allow-popups"
                allow="autoplay"
                referrerPolicy="no-referrer"
              />
              <p className="fine">
                Reference viewer · these files are not automatically marked. Use
                DokuGaku’s original timed paper for automatic answer capture and
                scoring. If the embedded preview is blocked, open it in Drive.
              </p>
            </>
          )}
        </>
      ) : (
        <p>
          No private source catalog is configured on this computer. The official
          workbooks below are available directly.
        </p>
      )}
    </section>
  );
}
