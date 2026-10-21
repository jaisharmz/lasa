export const DEFAULT_PAGES = 300;

export function slug(text) {
  const value = String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return value || "untitled";
}

export function shortTitle(title) {
  const base = String(title || "").split(/:|\s\(|\s-\s/)[0].trim();
  return base || String(title || "").trim();
}

export function bookKey(title) {
  return slug(shortTitle(title).replace(/^(the|a|an)\s+/i, ""));
}

export async function lookupOpenLibrary({ title, author }) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", shortTitle(title));
  if (author) url.searchParams.set("author", author.split(/[;,&]/)[0].trim());
  url.searchParams.set("limit", "1");
  url.searchParams.set("fields", "title,author_name,number_of_pages_median,cover_i,key,first_publish_year");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const match = (await response.json()).docs?.[0];
    if (!match) return null;
    return {
      author: match.author_name?.[0] || null,
      pages: match.number_of_pages_median || null,
      cover: match.cover_i ? `https://covers.openlibrary.org/b/id/${match.cover_i}-M.jpg?default=false` : null,
      year: match.first_publish_year || null,
      openLibrary: match.key ? `https://openlibrary.org${match.key}` : null,
    };
  } catch {
    return null;
  }
}

export function newBook(item, found) {
  return {
    key: bookKey(item.title),
    title: shortTitle(item.title),
    fullTitle: item.title,
    author: item.author || found?.author || null,
    pages: found?.pages || DEFAULT_PAGES,
    pagesEstimated: !found?.pages,
    cover: found?.cover || null,
    year: found?.year || null,
    openLibrary: found?.openLibrary || null,
    sources: { [item.source]: item.sourceId },
  };
}
