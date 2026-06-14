export function parseStructuredResponse<T>(response: string): T {
  const trimmed = response.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const objectStart = unfenced.indexOf("{");
    const arrayStart = unfenced.indexOf("[");
    const starts = [objectStart, arrayStart].filter(index => index >= 0);
    if (starts.length === 0) {
      throw new Error("Structured response did not contain JSON.");
    }

    const start = Math.min(...starts);
    const opening = unfenced[start];
    const closing = opening === "{" ? "}" : "]";
    const end = unfenced.lastIndexOf(closing);
    if (end <= start) {
      throw new Error("Structured response contained incomplete JSON.");
    }

    return JSON.parse(unfenced.slice(start, end + 1)) as T;
  }
}
