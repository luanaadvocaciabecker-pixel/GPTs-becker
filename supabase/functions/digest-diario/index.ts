import { createClient } from "jsr:@supabase/supabase-js@2";

const DATAJUD_KEY = Deno.env.get("DATAJUD_API_KEY") ??
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";
const RESEND_KEY  = Deno.env.get("RESEND_API_KEY") ?? "";
const DIGEST_TO   = Deno.env.get("DIGEST_EMAIL")   ?? "juridico1@advocaciabecker.com";
const DIGEST_FROM = Deno.env.get("DIGEST_FROM")    ?? "digest@advocaciabecker.com";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── helpers ────────────────────────────────────────────────────────────────

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function tribunalEndpoint(numero: string): string {
  const m = numero.replace(/\s/g, "").match(/^\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}$/);
  if (!m) return "api_publica_tjsc";
  const ramo = m[1], t = Number(m[2]);
  const uf = ["","","AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
  if (ramo === "8") return `api_publica_tj${(uf[t] ?? "SC").toLowerCase()}`;
  if (ramo === "5") return t === 1 ? "api_publica_stj" : t === 2 ? "api_publica_stf" : "api_publica_tjsc";
  if (ramo === "6") return `api_publica_trt${t}`;
  if (ramo === "4") return `api_publica_trf${t}`;
  if (ramo === "9") return "api_publica_tst";
  return "api_publica_tjsc";
}

async function buscarMovimentacoes(numero: string): Promise<Record<string, unknown>[]> {
  const endpoint = tribunalEndpoint(numero);
  const url = `https://api-publica.datajud.cnj.jus.br/${endpoint}/_search`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Authorization": `ApiKey ${DATAJUD_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        size: 1,
        query: { term: { "numeroProcesso.keyword": numero } },
        _source: ["movimentos"],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { hits?: { hits?: { _source?: { movimentos?: unknown[] } }[] } };
    const hits = data?.hits?.hits ?? [];
    if (!hits.length) return [];
    return ((hits[0]._source?.movimentos ?? []) as Record<string, unknown>[]).slice(0, 15);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── email ──────────────────────────────────────────────────────────────────

type Novidade = { processo: string; descricao: string; movimentos: { data: string; tipo: string; descricao: string }[] };

function renderEmail(novidades: Novidade[]): string {
  const rows = novidades.map(n => `
    <div style="margin-bottom:24px;border-left:4px solid #1a3a5c;padding-left:16px;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a3a5c;font-size:15px;">${n.processo}</p>
      ${n.descricao ? `<p style="margin:0 0 8px;color:#555;font-size:13px;">${n.descricao}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#f0f4f8;">
          <th style="padding:6px 8px;text-align:left;color:#444;">Data</th>
          <th style="padding:6px 8px;text-align:left;color:#444;">Movimento</th>
        </tr>
        ${n.movimentos.map((m, i) => `
        <tr style="background:${i % 2 === 0 ? "#fff" : "#f9fbfc"};">
          <td style="padding:6px 8px;white-space:nowrap;color:#333;">${m.data}</td>
          <td style="padding:6px 8px;color:#333;">${m.tipo ? `<strong>${m.tipo}</strong> — ` : ""}${m.descricao}</td>
        </tr>`).join("")}
      </table>
    </div>`).join("");

  const hoje = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric", timeZone:"America/Sao_Paulo" });
  return `
<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:700px;margin:auto;padding:24px;color:#222;">
  <div style="background:#1a3a5c;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;color:#fff;font-size:20px;">Digest Processual — ${hoje}</h1>
    <p style="margin:4px 0 0;color:#a8c4e0;font-size:13px;">${novidades.length} processo${novidades.length > 1 ? "s" : ""} com novidade${novidades.length > 1 ? "s" : ""}</p>
  </div>
  <div style="border:1px solid #dde3ea;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
    ${rows}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
    <p style="font-size:11px;color:#999;margin:0;">Advocacia Becker — monitor processual automático</p>
  </div>
</body></html>`;
}

async function enviarEmail(novidades: Novidade[]): Promise<boolean> {
  if (!RESEND_KEY) { console.warn("RESEND_API_KEY não configurada — e-mail não enviado"); return false; }
  const hoje = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric", timeZone:"America/Sao_Paulo" });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: DIGEST_FROM,
      to: DIGEST_TO,
      subject: `Digest Processual ${hoje} — ${novidades.length} novidade${novidades.length > 1 ? "s" : ""}`,
      html: renderEmail(novidades),
    }),
  });
  if (!res.ok) { console.error("Resend erro:", await res.text()); return false; }
  return true;
}

// ── main ───────────────────────────────────────────────────────────────────

async function rodar(): Promise<{ processos: number; novidades: number; status: string; detalhe?: string }> {
  const { data: processos, error: errP } = await supabase
    .from("processos_monitorados")
    .select("id, numero, descricao")
    .eq("ativo", true);
  if (errP) return { processos: 0, novidades: 0, status: "erro", detalhe: errP.message };
  if (!processos?.length) return { processos: 0, novidades: 0, status: "vazio", detalhe: "Nenhum processo cadastrado" };

  const novidades: Novidade[] = [];

  for (const proc of processos) {
    const movs = await buscarMovimentacoes(proc.numero);
    if (!movs.length) continue;

    const novas: Novidade["movimentos"] = [];

    for (const m of movs) {
      const data  = String(m.dataHora ?? m.data ?? "").slice(0, 10);
      const tipo  = String((m.codigo as Record<string,unknown>)?.descricao ?? (m.movimentoNacional as Record<string,unknown>)?.descricao ?? "");
      const desc  = String((m.complementosTabelados as Record<string,unknown>[])?.[0]?.descricao ?? m.nome ?? tipo ?? "Movimentação");
      const hash  = await sha256hex(`${proc.numero}|${data}|${desc}`);

      const { error: errIns } = await supabase
        .from("movimentacoes_historico")
        .insert({ processo_id: proc.id, numero: proc.numero, data_mov: data || null, tipo, descricao: desc, hash });

      if (!errIns) novas.push({ data: data || "—", tipo, descricao: desc });
    }

    if (novas.length) novidades.push({ processo: proc.numero, descricao: proc.descricao ?? "", movimentos: novas });
  }

  if (novidades.length) await enviarEmail(novidades);

  const total = novidades.reduce((s, n) => s + n.movimentos.length, 0);
  await supabase.from("digest_log").insert({
    processos: processos.length,
    novidades: total,
    status: total > 0 ? "ok" : "vazio",
  });

  return { processos: processos.length, novidades: total, status: total > 0 ? "ok" : "vazio" };
}

// ── serve ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const secret = Deno.env.get("DIGEST_SECRET");
  if (secret) {
    const auth = req.headers.get("x-digest-secret") ?? new URL(req.url).searchParams.get("secret");
    if (auth !== secret) return new Response("Unauthorized", { status: 401 });
  }

  try {
    const resultado = await rodar();
    return new Response(JSON.stringify(resultado), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ status: "erro", detalhe: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
