import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DraftEditor, type DraftInput } from "@/components/editor";
import { ErrorBox, PageTitle, SkeletonList } from "@/components/ui";
import { api, type ApiError } from "@/lib/api";
import { type DocumentDetail, useMe } from "@/lib/portal";
import { useT } from "@/l10n";

export const Route = createFileRoute("/app/documents/nouveau")({ component: NewDocument });

function NewDocument() {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save(input: DraftInput) {
    setSaving(true);
    setError(null);
    try {
      const doc = await api<DocumentDetail>("org", "/v1/portal/documents", { body: input });
      void navigate({ to: "/app/documents/$id", params: { id: doc.id } });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageTitle title={t.app.editor.newTitle} />
      {me.error && <ErrorBox onRetry={me.reload} />}
      {!me.data ? <SkeletonList rows={5} /> : <DraftEditor me={me.data} doc={null} onSave={save} saving={saving} error={error} />}
    </div>
  );
}
