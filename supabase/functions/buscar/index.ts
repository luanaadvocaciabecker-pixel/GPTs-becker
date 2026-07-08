import { createClient } from "jsr:@supabase/supabase-js@2";

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 768;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/privacy")) {
    return new Response(PRIVACY_POLICY, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (req.method !== "POST") {
    return json({ error: "Metodo nao permitido." }, 405);
  }

  try {
    const {
      query,
      tabela = "base",
      materia = null,
      tipo_peca = null,
      pasta = null,
      nivel = null,
      tema = null,
      tribunal = null,
      incluir_lacuna = true,
      k = 4,
    } = await req.json();

    if (!query || typeof query !== "string") {
      return json({ error: "Campo 'query' e obrigatorio." }, 400);
    }
    if (!['base', 'jurisprudencia'].includes(tabela)) {
      return json({ error: "Campo 'tabela' invalido." }, 400);
    }

    const googleKey = Deno.env.get("GOOGLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!googleKey || !supabaseUrl || !serviceRoleKey) {
      return json({ error: "Secrets da funcao nao configurados." }, 500);
    }

    const embResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": googleKey,
        },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: query }] },
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: EMBED_DIM,
        }),
      },
    );
    if (!embResp.ok) {
      console.error("Google embedding error", embResp.status, await embResp.text());
      return json({ error: "Falha ao gerar embedding no Google." }, 502);
    }
    const emb = (await embResp.json()).embedding.values;

    const sb = createClient(supabaseUrl, serviceRoleKey);
    const matchCount = Math.min(Math.max(Number(k) || 4, 1), 8);
    const rpc = tabela === "jurisprudencia" ? "buscar_jurisprudencia" : "buscar_base";
    const params = tabela === "jurisprudencia"
      ? {
          query_text: query,
          query_embedding: emb,
          p_tema: tema,
          p_tribunal: tribunal,
          match_count: matchCount,
        }
      : {
          query_text: query,
          query_embedding: emb,
          p_materia: materia,
          p_tipo_peca: tipo_peca,
          p_pasta: pasta,
          p_nivel: nivel,
          incluir_lacuna,
          match_count: matchCount,
        };

    const { data, error } = await sb.rpc(rpc, params);
    if (error) {
      console.error("Supabase RPC error", error);
      return json({ error: "Falha ao consultar a base." }, 500);
    }
    return json({ resultados: data });
  } catch (error) {
    console.error("Unexpected error", error);
    return json({ error: "Erro interno na busca." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const PRIVACY_POLICY = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Politica de Privacidade - Becker GPT Bancario</title></head>
<body><main><h1>Politica de Privacidade - Becker GPT Bancario</h1>
<p>Esta integracao recebe apenas o texto e os filtros enviados pelo usuario para consultar a base juridica privada do Becker Advogados.</p>
<p>Os dados sao processados pela Edge Function do Supabase e pela API Google Gemini exclusivamente para gerar vetores de busca. A integracao nao solicita senhas, dados de pagamento ou chaves de API do usuario.</p>
<p>Nao vendemos nem compartilhamos os dados recebidos para publicidade. Registros tecnicos temporarios podem ser mantidos pelos provedores para seguranca e operacao do servico.</p>
<p>Nao envie dados pessoais sensiveis ou documentos sigilosos sem a devida autorizacao e anonimizacao.</p>
<p>Para solicitar informacoes, correcao ou exclusao, contate o Becker Advogados.</p>
<p>Ultima atualizacao: 21 de junho de 2026.</p></main></body></html>`;
