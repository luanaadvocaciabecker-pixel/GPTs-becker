import { createClient } from "npm:@supabase/supabase-js@2";
import { load } from "npm:cheerio@1.0.0";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };
const insufficient = "Não foram localizados documentos suficientes para geração de resultado auditável.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

const datajudAccessPage = "https://datajud-wiki.cnj.jus.br/api-publica/acesso/";
const datajudTJSCSearch = "https://api-publica.datajud.cnj.jus.br/api_publica_tjsc/_search";
const datajudFallbackKey = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";
const datajudConnectorVersion = "1.0.0";

async function currentDatajudKey() {
  const response = await fetch(datajudAccessPage, {
    headers: { "User-Agent": "BeckerJurisIntelligence/1.0 (official metadata discovery)" },
  });
  if (!response.ok) return datajudFallbackKey;
  const html = await response.text();
  return html.match(/Authorization:\s*APIKey\s+([A-Za-z0-9+/=]+)/i)?.[1] ?? datajudFallbackKey;
}

function datajudRequest(query: string, limit: number, operator: "and" | "or") {
  return {
    size: limit,
    query: {
      simple_query_string: {
        query,
        fields: ["assuntos.nome^3", "classe.nome^2", "movimentos.nome"],
        default_operator: operator,
        flags: "OR|AND|NOT|PHRASE|PREFIX|WHITESPACE",
      },
    },
    sort: [{ dataAjuizamento: { order: "desc" } }],
    _source: [
      "numeroProcesso", "classe", "assuntos", "orgaoJulgador", "movimentos",
      "grau", "tribunal", "dataAjuizamento", "nivelSigilo", "formato", "sistema",
    ],
  };
}

function rmcDatajudRequest(query: string, limit: number) {
  const must = /dano\s+moral/i.test(query)
    ? [{ match_phrase: { "assuntos.nome": "Dano Moral" } }]
    : [];
  return {
    size: limit,
    query: {
      bool: {
        must,
        should: [
          { match_phrase: { "assuntos.nome": "Cartão de Crédito" } },
          { match_phrase: { "assuntos.nome": "Empréstimo consignado" } },
          { match_phrase: { "assuntos.nome": "Reserva de Margem Consignável" } },
        ],
        minimum_should_match: 1,
      },
    },
    sort: [{ dataAjuizamento: { order: "desc" } }],
    _source: [
      "numeroProcesso", "classe", "assuntos", "orgaoJulgador", "movimentos",
      "grau", "tribunal", "dataAjuizamento", "nivelSigilo", "formato", "sistema",
    ],
  };
}

async function queryDatajud(query: string, limit: number) {
  const apiKey = await currentDatajudKey();
  let strategy: "rmc_subject_expansion" | "structured_and" | "structured_or" = /\bRMC\b|\bRCC\b/i.test(query)
    ? "rmc_subject_expansion"
    : "structured_and";
  let requestBody = strategy === "rmc_subject_expansion"
    ? rmcDatajudRequest(query, limit)
    : datajudRequest(query, limit, "and");

  async function execute(body: Record<string, unknown>) {
    const response = await fetch(datajudTJSCSearch, {
      method: "POST",
      headers: {
        Authorization: `APIKey ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "BeckerJurisIntelligence/1.0 (official metadata discovery)",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`DataJud respondeu HTTP ${response.status}`);
    return await response.json();
  }

  let payload = await execute(requestBody);
  if ((payload?.hits?.hits ?? []).length === 0 && strategy !== "rmc_subject_expansion") {
    strategy = "structured_or";
    requestBody = datajudRequest(query, limit, "or");
    payload = await execute(requestBody);
  }

  const results = (payload?.hits?.hits ?? []).map((hit: Record<string, unknown>) => {
    const source = (hit._source ?? {}) as Record<string, unknown>;
    const movements = Array.isArray(source.movimentos) ? [...source.movimentos] : [];
    movements.sort((left, right) => String(right.dataHora ?? "").localeCompare(String(left.dataHora ?? "")));
    return {
      source_identifier: String(hit._id ?? source.numeroProcesso ?? ""),
      case_number: source.numeroProcesso ?? null,
      tribunal: source.tribunal ?? "TJSC",
      degree: source.grau ?? null,
      filing_date: source.dataAjuizamento ?? null,
      procedural_class: (source.classe as Record<string, unknown> | undefined)?.nome ?? null,
      subjects: Array.isArray(source.assuntos)
        ? source.assuntos.map((item: Record<string, unknown>) => item.nome).filter(Boolean)
        : [],
      judging_body: (source.orgaoJulgador as Record<string, unknown> | undefined)?.nome ?? null,
      format: (source.formato as Record<string, unknown> | undefined)?.nome ?? null,
      system: (source.sistema as Record<string, unknown> | undefined)?.nome ?? null,
      latest_movements: movements.slice(0, 5).map((item: Record<string, unknown>) => ({
        code: item.codigo ?? null,
        name: item.nome ?? null,
        date: item.dataHora ?? null,
      })),
    };
  });

  return {
    strategy,
    requestBody,
    total: Number(payload?.hits?.total?.value ?? results.length),
    results,
  };
}

const tjscEprocBase = "https://eprocwebcon.tjsc.jus.br/consulta1g/";
const tjscEprocSearch = new URL(
  "externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados",
  tjscEprocBase,
).toString();
const tjscEprocConnectorVersion = "2.0.0";
const tjscHeaders = {
  "User-Agent": "BeckerJurisIntelligence/2.0 (official jurisprudence capture)",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

function decodeTJSC(bytes: Uint8Array) {
  return new TextDecoder("windows-1252").decode(bytes);
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isoDate(value: string | null) {
  const match = value?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function cardValue($: ReturnType<typeof load>, card: ReturnType<ReturnType<typeof load>>, label: string) {
  let value = "";
  card.find(".resLabel").each((_, element) => {
    if (compactText($(element).text()).toLocaleUpperCase("pt-BR") === label.toLocaleUpperCase("pt-BR")) {
      value = compactText($(element).parent().find(".resValue").first().text());
    }
  });
  return value || null;
}

async function fetchTJSCResults(query: string, limit: number) {
  const form = new URLSearchParams();
  form.set("txtPesquisa", query);
  form.append("selOrigem[]", "1");
  form.append("selTipoDocumento[]", "1");
  form.set("rdoCampo", "I");
  form.set("chkAgruparResultados", "on");
  const response = await fetch(tjscEprocSearch, {
    method: "POST",
    headers: { ...tjscHeaders, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!response.ok) throw new Error(`TJSC respondeu HTTP ${response.status}`);
  const html = decodeTJSC(new Uint8Array(await response.arrayBuffer()));
  const $ = load(html);
  const results: Array<Record<string, unknown>> = [];

  $(".resultadoItem").each((_, element) => {
    if (results.length >= limit) return;
    const card = $(element);
    const rawDownload = card.find(".inteiroTeor").attr("data-link");
    const caseText = compactText(card.find(".numero-processo").first().text());
    const caseNumber = caseText.match(/\d{7}-\d{2}\.\d{4}\.8\.24\.\d{4}/)?.[0] ?? null;
    if (!rawDownload || !caseNumber) return;
    const processType = compactText(card.find(".numero-processo").first().closest(".row").find("span").first().text());
    results.push({
      source_identifier: String(card.attr("id") ?? "").replace(/^resultado/, ""),
      source_url: new URL(rawDownload.replace(/&amp;/g, "&"), tjscEprocBase).toString(),
      process_url: card.find(".numero-processo").first().attr("href") ?? null,
      case_number: caseNumber,
      procedural_class: processType || null,
      judging_body: cardValue($, card, "ÓRGÃO JULGADOR"),
      judgment_date: isoDate(cardValue($, card, "DATA DO JULGAMENTO")),
      publication_date: isoDate(cardValue($, card, "DATA DA PUBLICAÇÃO")),
      rapporteur: cardValue($, card, "RELATOR"),
      decision: cardValue($, card, "DECISÃO"),
      official_headnote: cardValue($, card, "EMENTA"),
      official_citation: card.find(".copiarCitacao").first().attr("data-citacao") ?? null,
    });
  });
  return results;
}

async function sha256Bytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function extractTJSCText(bytes: Uint8Array, result: Record<string, unknown>) {
  const $ = load(decodeTJSC(bytes));
  $("script,style,noscript").remove();
  const fullText = compactText($("body").text());
  return [
    result.official_headnote ? `EMENTA\n${result.official_headnote}` : "",
    result.decision ? `DECISÃO\n${result.decision}` : "",
    `INTEIRO TEOR\n${fullText}`,
  ].filter(Boolean).join("\n\n");
}

async function buildChunks(text: string) {
  const chunks = [];
  let paragraph = 0;
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 1800, text.length);
    if (end < text.length) {
      const window = text.slice(start + 1000, end);
      const sentenceBreak = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf(": "));
      const wordBreak = window.lastIndexOf(" ");
      const relativeBreak = sentenceBreak >= 0 ? sentenceBreak + 1 : wordBreak;
      if (relativeBreak > 0) end = start + 1000 + relativeBreak;
    }
    const leading = text.slice(start, end).match(/^\s*/)?.[0].length ?? 0;
    const contentStart = start + leading;
    const content = text.slice(contentStart, end).trimEnd();
    if (!content) {
      start = end;
      continue;
    }
    paragraph += 1;
    chunks.push({
      page: null,
      paragraph,
      start_offset: contentStart,
      end_offset: contentStart + content.length,
      content,
      sha256: await sha256(content),
      embedding: `[${embedding(content).join(",")}]`,
    });
    start = end;
  }
  return chunks;
}

function evidenceExcerpt(value: unknown, query = "") {
  let text = compactText(String(value ?? ""));
  const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const genericLegalTerms = new Set(["dano", "danos", "moral", "morais"]);
  const terms = normalizedTerms(query);
  const focusTerms = [
    ...terms.filter((term) => !genericLegalTerms.has(term)),
    ...terms.filter((term) => genericLegalTerms.has(term)),
  ];
  const focus = focusTerms.map((term) => normalizedText.indexOf(term)).find((index) => index >= 0) ?? -1;
  if (focus > 350) {
    const start = Math.max(0, focus - 250);
    text = text.slice(start, start + 700).trim();
    const firstSpace = text.indexOf(" ");
    const lastSpace = text.lastIndexOf(" ");
    if (firstSpace > 0) text = text.slice(firstSpace + 1);
    if (lastSpace > 500) text = text.slice(0, lastSpace).trim();
    return text;
  }
  const firstStop = text.search(/[.;:]\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/u);
  if (firstStop >= 0 && firstStop < 300) text = text.slice(firstStop + 1).trim();
  const maximumLength = 700;
  if (text.length > maximumLength) {
    const window = text.slice(0, maximumLength);
    const lastStop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf(": "));
    text = (lastStop > 500 ? window.slice(0, lastStop + 1) : window).trim();
  }
  return text;
}

async function ingestTJSC(
  supabase: ReturnType<typeof createClient>,
  query: string,
  limit: number,
  methodologyId: string,
  createdBy: string,
) {
  const candidates = await fetchTJSCResults(query, limit);
  const captured = [];
  for (const candidate of candidates) {
    const { data: existingBySource, error: sourceLookupError } = await supabase
      .from("bji_documents")
      .select("id,case_number,sha256")
      .eq("tribunal", "TJSC")
      .eq("source_identifier", candidate.source_identifier)
      .limit(1)
      .maybeSingle();
    if (sourceLookupError) throw new Error(`Falha ao verificar documento existente: ${sourceLookupError.message}`);
    if (existingBySource) {
      captured.push({
        ...candidate,
        document_id: existingBySource.id,
        sha256: existingBySource.sha256,
        reused: true,
      });
      continue;
    }

    const response = await fetch(String(candidate.source_url), { headers: tjscHeaders });
    if (!response.ok) throw new Error(`TJSC inteiro teor respondeu HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const documentHash = await sha256Bytes(bytes);
    const { data: existing } = await supabase
      .from("bji_documents")
      .select("id,case_number,sha256")
      .eq("sha256", documentHash)
      .maybeSingle();
    if (existing) {
      captured.push({ ...candidate, document_id: existing.id, sha256: existing.sha256, reused: true });
      continue;
    }

    const text = extractTJSCText(bytes, candidate);
    const textHash = await sha256(text);
    const chunks = await buildChunks(text);
    const storagePath = `tjsc/${String(candidate.case_number).replace(/\D/g, "")}/${documentHash}.html`;
    const { error: uploadError } = await supabase.storage
      .from("becker-originals")
      .upload(storagePath, bytes, { contentType: "text/html", cacheControl: "31536000", upsert: false });
    if (uploadError) throw new Error(`Falha ao armazenar original: ${uploadError.message}`);

    const document = {
      tribunal: "TJSC",
      source_url: candidate.source_url,
      source_identifier: candidate.source_identifier,
      media_type: "text/html",
      storage_path: storagePath,
      sha256: documentHash,
      byte_size: bytes.byteLength,
      case_number: candidate.case_number,
      judging_body: candidate.judging_body,
      rapporteur: candidate.rapporteur,
      judgment_date: candidate.judgment_date,
      publication_date: candidate.publication_date,
      procedural_class: candidate.procedural_class,
      connector_version: tjscEprocConnectorVersion,
      metadata: {
        portal: "TJSC eproc jurisprudencia",
        query,
        process_url: candidate.process_url,
        official_headnote: candidate.official_headnote,
        decision: candidate.decision,
        official_citation: candidate.official_citation,
      },
    };
    const { data: documentId, error: persistError } = await supabase.rpc("bji_persist_document", {
      p_document: document,
      p_methodology_id: methodologyId,
      p_text_hash: textHash,
      p_chunks: chunks,
      p_created_by: createdBy,
    });
    if (persistError) throw new Error(`Falha ao persistir documento: ${persistError.message}`);
    captured.push({
      ...candidate,
      document_id: documentId,
      sha256: documentHash,
      chunks: chunks.length,
      byte_size: bytes.byteLength,
      reused: false,
    });
  }
  return captured;
}

const tstBackendUrl = "https://jurisprudencia-backend2.tst.jus.br";
const tstAcordaoUrl = "https://consultadocumento.tst.jus.br/consultaDocumento/acordao.do";
const jtConnectorVersion = "2.0.0";
const jtBrowserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
  "Accept": "application/json",
  "Origin": "https://jurisprudencia.tst.jus.br",
  "Referer": "https://jurisprudencia.tst.jus.br/",
};

interface TSTRegistro {
  id: unknown;
  numFormatado: unknown;
  numeracaoUnica: unknown;
  orgaoJudicante: unknown;
  nomRelator: unknown;
  dtaJulgamento: unknown;
  dtaOrdenacao: unknown;
  dtaPublicacao: unknown;
  ementa: unknown;
  ementaHtml: unknown;
  txtConteudoDecisao: unknown;
  txtInteiroTeor: unknown;
  inteiroTeorHtml: unknown;
  numProcInt: unknown;
  anoProcInt: unknown;
  tipo: unknown;
}

function tstIsoDate(value: unknown) {
  const str = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return isoDate(str);
}

function stripHtml(html: string) {
  return compactText(html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
}

async function fetchTSTResults(query: string, limit: number) {
  const body = {
    ou: query,
    e: "",
    naoContem: "",
    ementa: "",
    dispositivo: "",
  };
  const response = await fetch(`${tstBackendUrl}/rest/pesquisa-textual/1/${limit}`, {
    method: "POST",
    headers: { ...jtBrowserHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`TST backend respondeu HTTP ${response.status}`);
  const payload = await response.json();
  const registros: TSTRegistro[] = (payload?.registros ?? []).map((r: Record<string, unknown>) => r.registro ?? r);
  return registros.slice(0, limit).map((reg) => {
    const rawFullText = String(reg.txtConteudoDecisao ?? reg.inteiroTeorHtml ?? reg.txtInteiroTeor ?? "");
    const fullText = rawFullText.trim().startsWith("<") ? stripHtml(rawFullText) : compactText(rawFullText);
    const ementa = stripHtml(String(reg.ementaHtml ?? reg.ementa ?? ""));
    const nu = reg.numeracaoUnica as Record<string, unknown> | null | undefined;
    const caseNumber = nu && typeof nu === "object"
      ? `${String(nu.numero ?? "").padStart(7, "0")}-${String(nu.digito ?? "").padStart(2, "0")}.${nu.ano}.${nu.orgao}.${String(nu.tribunal ?? "").padStart(2, "0")}.${String(nu.vara ?? "").padStart(4, "0")}`
      : String(reg.numFormatado ?? reg.id ?? "");
    const numProcInt = String(reg.numProcInt ?? "");
    const anoProcInt = String(reg.anoProcInt ?? "");
    const sourceUrl = numProcInt && anoProcInt && anoProcInt !== "0"
      ? `${tstAcordaoUrl}?numeroInt=${numProcInt}&anoInt=${anoProcInt}`
      : null;
    return {
      source_identifier: String(reg.id ?? caseNumber),
      source_url: sourceUrl,
      case_number: caseNumber || null,
      tribunal: "TST",
      judging_body: (typeof reg.orgaoJudicante === "object" && reg.orgaoJudicante !== null
        ? String((reg.orgaoJudicante as Record<string, unknown>).nome ?? (reg.orgaoJudicante as Record<string, unknown>).descricao ?? "")
        : String(reg.orgaoJudicante ?? "")).trim() || null,
      rapporteur: String(reg.nomRelator ?? "").trim() || null,
      judgment_date: tstIsoDate(reg.dtaJulgamento ?? reg.dtaOrdenacao),
      publication_date: tstIsoDate(reg.dtaPublicacao),
      procedural_class: String(reg.numFormatado ?? "").match(/^([A-Za-z]+(?:-[A-Za-z]+)?)\s*-/)?.[1]?.toUpperCase() ?? null,
      official_headnote: ementa || null,
      full_text: fullText || ementa || null,
    };
  }).filter((c) => c.case_number && (c.full_text || c.official_headnote));
}

async function ingestJT(
  supabase: ReturnType<typeof createClient>,
  query: string,
  tribunal: string,
  limit: number,
  methodologyId: string,
  createdBy: string,
) {
  if (tribunal !== "TST") {
    throw new Error(`Tribunal ${tribunal} ainda não tem conector implementado. Use TST.`);
  }
  const candidates = await fetchTSTResults(query, limit);
  const captured = [];
  for (const candidate of candidates) {
    const { data: existingBySource } = await supabase
      .from("bji_documents")
      .select("id,case_number,sha256")
      .eq("tribunal", candidate.tribunal)
      .eq("source_identifier", candidate.source_identifier)
      .limit(1)
      .maybeSingle();
    if (existingBySource) {
      captured.push({ ...candidate, document_id: existingBySource.id, sha256: existingBySource.sha256, reused: true, full_text: undefined });
      continue;
    }

    const text = [
      candidate.official_headnote ? `EMENTA\n${candidate.official_headnote}` : "",
      candidate.full_text ? `INTEIRO TEOR\n${candidate.full_text}` : "",
    ].filter(Boolean).join("\n\n");

    const textBytes = new TextEncoder().encode(text);
    const documentHash = await sha256Bytes(textBytes);

    const { data: existing } = await supabase
      .from("bji_documents")
      .select("id,case_number,sha256")
      .eq("sha256", documentHash)
      .maybeSingle();
    if (existing) {
      captured.push({ ...candidate, document_id: existing.id, sha256: existing.sha256, reused: true, full_text: undefined });
      continue;
    }

    const textHash = await sha256(text);
    const chunks = await buildChunks(text);
    const safeCaseNumber = String(candidate.case_number).replace(/\D/g, "");
    const storagePath = `jt/tst/${safeCaseNumber}/${documentHash}.txt`;

    const { error: uploadError } = await supabase.storage
      .from("becker-originals")
      .upload(storagePath, textBytes, { contentType: "text/plain", cacheControl: "31536000", upsert: true });
    if (uploadError) throw new Error(`Falha ao armazenar texto TST: ${uploadError.message}`);

    const document = {
      tribunal: "TST",
      source_url: candidate.source_url,
      source_identifier: candidate.source_identifier,
      media_type: "text/plain",
      storage_path: storagePath,
      sha256: documentHash,
      byte_size: textBytes.byteLength,
      case_number: candidate.case_number,
      judging_body: candidate.judging_body,
      rapporteur: candidate.rapporteur,
      judgment_date: candidate.judgment_date,
      publication_date: candidate.publication_date,
      procedural_class: candidate.procedural_class,
      connector_version: jtConnectorVersion,
      metadata: {
        portal: "TST Jurisprudência",
        query,
        official_headnote: candidate.official_headnote,
      },
    };
    const { data: documentId, error: persistError } = await supabase.rpc("bji_persist_document", {
      p_document: document,
      p_methodology_id: methodologyId,
      p_text_hash: textHash,
      p_chunks: chunks,
      p_created_by: createdBy,
    });
    if (persistError) throw new Error(`Falha ao persistir documento TST: ${persistError.message}`);
    captured.push({
      ...candidate,
      document_id: documentId,
      sha256: documentHash,
      chunks: chunks.length,
      byte_size: textBytes.byteLength,
      reused: false,
      full_text: undefined,
    });
  }
  return captured;
}

function embedding(text: string, dimensions = 128) {
  const vector = Array<number>(dimensions).fill(0);
  for (const token of text.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}_]+/gu) ?? []) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index++) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const unsigned = hash >>> 0;
    vector[unsigned % dimensions] += (unsigned & 256) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function normalizedTerms(value: string) {
  const expanded = expandLegalAcronyms(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  const ignored = new Set(["com", "das", "de", "do", "dos", "e", "em", "na", "no", "para", "por", "uma"]);
  return [...new Set((expanded.match(/[a-z0-9]+/g) ?? []).filter((term) => term.length > 2 && !ignored.has(term)))];
}

function expandLegalAcronyms(value: string) {
  return value
    .replace(/\bRMC\b/gi, "reserva margem consignavel")
    .replace(/\bRCC\b/gi, "reserva cartao consignado");
}

function supportsQuery(content: unknown, query: string) {
  const terms = normalizedTerms(query);
  if (terms.length === 0) return false;
  const haystack = String(content ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  const matched = terms.filter((term) => haystack.includes(term)).length;
  const required = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length / 2));
  const genericLegalTerms = new Set(["dano", "danos", "moral", "morais"]);
  const distinctive = terms.filter((term) => !genericLegalTerms.has(term));
  const distinctiveMatched = distinctive.filter((term) => haystack.includes(term)).length;
  const distinctiveRequired = distinctive.length <= 2
    ? distinctive.length
    : Math.ceil(distinctive.length / 2);
  return matched >= required && (distinctive.length === 0 || distinctiveMatched >= distinctiveRequired);
}

function normalizeJurisdiction(value: unknown) {
  const input = String(value ?? "").trim().toLocaleUpperCase("pt-BR");
  if (!input) return "SC";
  const court = input.match(/^TJ([A-Z]{2})$/)?.[1];
  if (court) return court;
  if (/^[A-Z]{2}$/.test(input)) return input;
  const aliases: Record<string, string> = {
    "SANTA CATARINA": "SC", "SAO PAULO": "SP", "SÃO PAULO": "SP",
    "PARANA": "PR", "PARANÁ": "PR", "RIO GRANDE DO SUL": "RS",
    "RIO DE JANEIRO": "RJ", "MINAS GERAIS": "MG",
  };
  return aliases[input] ?? "SC";
}

function courtPriority(tribunal: unknown, jurisdiction: string, area = "") {
  const court = String(tribunal ?? "").toUpperCase();
  if (area === "trabalhista") {
    if (jurisdiction === "SC" && court === "TRT12") return 0;
    if (court === "TST") return 1;
    if (court.startsWith("TRT")) return 2;
    return 9;
  }
  if (court === `TJ${jurisdiction}`) return 0;
  if (court === "STJ") return 1;
  if (court === "STF") return 2;
  if (jurisdiction === "SC" && court === "TRF4") return 3;
  if (jurisdiction === "SC" && court === "TRT12") return 4;
  return 5;
}

function citation(item: Record<string, unknown>) {
  const date = item.judgment_date
    ? new Date(String(item.judgment_date) + "T00:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })
    : "data não informada na fonte";
  const rapporteur = item.rapporteur || "relator não informado na fonte";
  return `EMENTA/TRECHO ORIGINAL: "${item.content}" (${item.tribunal}, Processo nº ${item.case_number}, Rel. ${rapporteur}, j. ${date}).`;
}

function citationDate(value: unknown) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function citationCourt(value: unknown) {
  const court = String(value ?? "").toUpperCase();
  const stateCourt = court.match(/^TJ([A-Z]{2})$/);
  return stateCourt ? `TJ-${stateCourt[1]}` : court;
}

function citationClass(value: unknown) {
  const proceduralClass = compactText(String(value ?? ""));
  if (/APCIV|APELAÇÃO CÍVEL|APELAÇÃO$/iu.test(proceduralClass)) return "Apelação Cível";
  return proceduralClass || "Classe processual não informada";
}

function citationJudgingBody(
  item: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  if (item.judging_body) return compactText(String(item.judging_body));
  const officialCitation = String(metadata.official_citation ?? "");
  const caseNumber = String(item.case_number ?? "");
  const casePosition = officialCitation.indexOf(caseNumber);
  if (casePosition < 0) return null;
  const afterCase = officialCitation.slice(casePosition + caseNumber.length);
  return afterCase.match(/^\s*,\s*([^,]+?)\s*,\s*Relator/iu)?.[1]?.trim() || null;
}

function citationForPetition(
  item: Record<string, unknown>,
  document: Record<string, unknown>,
) {
  const metadata = (document.metadata ?? {}) as Record<string, unknown>;
  const officialHeadnote = String(metadata.official_headnote ?? "").trim();
  if (!officialHeadnote) return String(metadata.official_citation || citation(item));

  const reference = [
    `${citationCourt(item.tribunal)} - ${citationClass(document.procedural_class)}: ${item.case_number}`,
    item.rapporteur ? `Relator(a): ${compactText(String(item.rapporteur))}` : null,
    citationDate(item.judgment_date) ? `Data de Julgamento: ${citationDate(item.judgment_date)}` : null,
    citationJudgingBody(item, metadata),
    citationDate(document.publication_date) ? `Data de Publicação: ${citationDate(document.publication_date)}` : null,
  ].filter(Boolean);
  return `${officialHeadnote}\n\n(${reference.join(", ")})`;
}

function headnoteSegments(value: unknown) {
  return compactText(String(value ?? ""))
    .replace(/^EMENTA:\s*/i, "")
    .split(/\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/u)
    .map((segment) => segment.trim().replace(/[.;]+$/, ""))
    .filter((segment) => segment.length > 3);
}

function sentenceCase(value: string) {
  const compact = compactText(value);
  if (!compact) return "";
  let result = compact.charAt(0).toLocaleUpperCase("pt-BR") + compact.slice(1).toLocaleLowerCase("pt-BR");
  for (const acronym of ["TJSC", "STJ", "STF", "TRF4", "TRT12", "CPC", "CDC", "CC", "CF"]) {
    result = result.replace(new RegExp(`\\b${acronym.toLocaleLowerCase("pt-BR")}\\b`, "g"), acronym);
  }
  return /[.!?]$/.test(result) ? result : `${result}.`;
}

function selectSegments(segments: string[], pattern: RegExp, limit: number) {
  return segments.filter((segment) => pattern.test(segment)).slice(0, limit);
}

function extractLegalGrounds(value: string) {
  const matches = value.match(/ART(?:IGO)?\.?\s*\d+[A-Zº°-]*(?:\s*,?\s*§\s*\d+[º°]?)?(?:\s+DO\s+(?:CPC|CDC|CC|CF))?/giu) ?? [];
  return [...new Set(matches.map((match) => compactText(match).toUpperCase()))];
}

function boundedText(value: string, maximumLength = 1200) {
  const text = compactText(value).replace(/^["'\\]+|["'\\]+$/g, "");
  if (text.length <= maximumLength) return text;
  const window = text.slice(0, maximumLength);
  const stop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "));
  return (stop > maximumLength / 2 ? window.slice(0, stop + 1) : window).trim();
}

function officialHeadnoteSections(value: unknown) {
  const text = compactText(String(value ?? ""));
  const section = (pattern: RegExp) => boundedText(text.match(pattern)?.[1] ?? "");
  const thesis = section(/TESE DE JULGAMENTO:\s*["'\\]*([\s\S]*?)(?=DISPOSITIVOS? RELEVANTES|JURISPRUDÊNCIA RELEVANTE|$)/iu);
  return {
    caseExam: section(/I\.\s*CASO EM EXAME\s*([\s\S]*?)(?=II\.\s*QUESTÃO EM DISCUSSÃO)/iu),
    issue: section(/II\.\s*QUESTÃO EM DISCUSSÃO\s*([\s\S]*?)(?=III\.\s*RAZÕES DE DECIDIR)/iu),
    reasons: section(/III\.\s*RAZÕES DE DECIDIR\s*([\s\S]*?)(?=IV\.\s*DISPOSITIVO E TESE)/iu),
    dispositive: section(/IV\.\s*DISPOSITIVO E TESE\s*([\s\S]*?)(?=TESE DE JULGAMENTO:|DISPOSITIVOS? RELEVANTES|JURISPRUDÊNCIA RELEVANTE|$)/iu),
    thesis,
  };
}

function buildStructuredArtifacts(
  items: Record<string, unknown>[],
  documents: Map<string, Record<string, unknown>>,
) {
  const primary = items[0];
  const primaryDocument = documents.get(String(primary.document_id)) ?? {};
  const metadata = (primaryDocument.metadata ?? {}) as Record<string, unknown>;
  const segments = headnoteSegments(metadata.official_headnote || primary.content);
  const officialSections = officialHeadnoteSections(metadata.official_headnote);
  const outcomePattern = /RECURSO|SENTENÇA|PROVID|DESPROVID|PROCEDÊNCIA|IMPROCEDÊNCIA|MANTID|REFORM/u;
  const issuePattern = /ALEGAD|INSURG|CONTROV|QUESTÃO|PRETENS|DISCUSS/u;
  const strongReasonPattern = /PROVA TÉCNICA|AUSÊNCIA|INEXISTÊNCIA|NÃO CONFIGURA|NEXO CAUSAL|RESPONDE|DEVER/u;
  const reasonPattern = /PROVA|AUSÊNCIA|INEXISTÊNCIA|NÃO CONFIGURA|CONFIGURA|DEMONSTRA|NEXO|CULPA|FALHA|RISCO|DEVER|RESPONSABIL|ADEQUA|PRESCRI|RESTITUI/u;
  const caseSegments = segments.slice(0, Math.min(3, segments.length));
  const issueSegments = selectSegments(segments, issuePattern, 2);
  const outcomeSegments = selectSegments(segments, outcomePattern, 3).slice(-2);
  const strongReasons = segments.filter((segment) => strongReasonPattern.test(segment) && !outcomePattern.test(segment));
  const otherReasons = segments.filter((segment) => reasonPattern.test(segment) && !outcomePattern.test(segment) && !strongReasons.includes(segment));
  let reasonSegments = [...strongReasons, ...otherReasons].slice(0, 4);
  if (reasonSegments.length === 0) reasonSegments = segments.filter((segment) => !outcomePattern.test(segment)).slice(-3);

  const mainThesis = officialSections.thesis || reasonSegments.map(sentenceCase).join(" ");
  const dispositive = officialSections.dispositive || (outcomeSegments.length ? outcomeSegments : segments.slice(-1)).map(sentenceCase).join(" ");
  const caseExam = officialSections.caseExam || caseSegments.map(sentenceCase).join(" ");
  const issue = officialSections.issue || (issueSegments.length ? issueSegments : caseSegments.slice(-1)).map(sentenceCase).join(" ");
  const reasons = officialSections.reasons || reasonSegments.map(sentenceCase).join(" ");
  const process = String(primary.case_number ?? "processo não informado");
  const tribunal = String(primary.tribunal ?? "tribunal não informado");
  const petitionGrounding = `No julgamento do processo ${process}, o ${tribunal} assentou o seguinte entendimento: ${mainThesis} O resultado registrado na ementa oficial foi: ${dispositive}`;

  const secondaryTheses = items.slice(1).map((item) => {
    const document = documents.get(String(item.document_id)) ?? {};
    const itemMetadata = (document.metadata ?? {}) as Record<string, unknown>;
    const itemSegments = headnoteSegments(itemMetadata.official_headnote || item.content);
    const itemReasons = itemSegments.filter((segment) => reasonPattern.test(segment) && !outcomePattern.test(segment)).slice(0, 2);
    return (itemReasons.length ? itemReasons : itemSegments.slice(-2)).map(sentenceCase).join(" ");
  }).filter(Boolean);

  return {
    main_thesis: mainThesis,
    secondary_theses: secondaryTheses,
    petition_grounding: petitionGrounding,
    becker_headnote: {
      "I. Caso em exame": caseExam,
      "II. Questão em discussão": issue,
      "III. Razões de decidir": reasons,
      "IV. Dispositivo e tese": dispositive,
    },
    ratio_decidendi: officialSections.reasons ? [officialSections.reasons] : reasonSegments.map(sentenceCase),
    obiter_dicta: [],
    legal_grounds: extractLegalGrounds(String(metadata.official_headnote ?? "")),
  };
}

function requestApiKey(req: Request) {
  const authorization = req.headers.get("Authorization")?.trim() ?? "";
  const authorizationKey = authorization.match(/^(?:Bearer|APIKey)\s+(.+)$/i)?.[1]?.trim();
  return req.headers.get("X-API-Key")?.trim() || authorizationKey || null;
}

async function authenticate(req: Request, supabase: ReturnType<typeof createClient>) {
  const key = requestApiKey(req);
  if (!key) return null;
  const keyHash = await sha256(key);
  const { data } = await supabase
    .from("bji_api_keys")
    .select("name,role")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .maybeSingle();
  return data;
}

async function serializeArtifact(supabase: ReturnType<typeof createClient>, artifactId: string) {
  const { data: artifact, error } = await supabase
    .from("bji_research_artifacts")
    .select("*,bji_research_runs(*),bji_processing_runs(*,bji_methodologies(*))")
    .eq("id", artifactId)
    .single();
  if (error || !artifact) return null;
  const { data: units } = await supabase
    .from("bji_citation_units")
    .select("*,bji_documents(*),bji_chunks(*)")
    .eq("research_artifact_id", artifactId)
    .order("position");
  const run = artifact.bji_processing_runs;
  const research = artifact.bji_research_runs;
  return {
    research_run_id: artifact.research_run_id,
    artifact_id: artifact.id,
    version: artifact.version,
    main_thesis: artifact.main_thesis,
    secondary_theses: artifact.secondary_theses,
    jurisprudence_for_citation: (units ?? []).map((unit) => unit.formatted_citation),
    petition_grounding: artifact.petition_grounding,
    becker_headnote: artifact.becker_headnote,
    ratio_decidendi: artifact.ratio_decidendi,
    obiter_dicta: artifact.obiter_dicta,
    legal_grounds: artifact.legal_grounds,
    citation_units: (units ?? []).map((unit) => ({
      id: unit.id,
      purpose: unit.purpose,
      original_text: unit.original_text,
      formatted_citation: unit.formatted_citation,
      page: unit.bji_chunks.page,
      position: {
        paragraph: unit.bji_chunks.paragraph,
        start_offset: unit.bji_chunks.start_offset,
        end_offset: unit.bji_chunks.end_offset,
      },
      tribunal: unit.bji_documents.tribunal,
      judging_body: unit.bji_documents.judging_body,
      rapporteur: unit.bji_documents.rapporteur,
      process: unit.bji_documents.case_number,
      judgment_date: unit.bji_documents.judgment_date,
      original_document: unit.bji_documents.source_url,
      document_hash: unit.bji_documents.sha256,
      snippet_hash: unit.bji_chunks.sha256,
    })),
    traceability: {
      methodology: run.bji_methodologies.code,
      methodology_version: run.bji_methodologies.version,
      processing_run: run.id,
      input_hash: run.input_hash,
      output_hash: run.output_hash,
      search_steps: research.search_steps,
      ranking: (Array.isArray(research.ranking) ? research.ranking : []).map((item: Record<string, unknown>) => ({
        document_id: item.document_id,
        chunk_id: item.chunk_id,
        tribunal: item.tribunal,
        case_number: item.case_number,
        score_lexical: item.score_lexical,
        score_semantic: item.score_semantic,
        score_final: item.score_final,
      })),
    },
    copy_actions: {
      jurisprudence: "COPIAR JURISPRUDÊNCIA",
      petition_grounding: "COPIAR FUNDAMENTAÇÃO",
    },
  };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/becker-juris/, "") || "/";
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...jsonHeaders, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-api-key,authorization" } });
  }
  if (path === "/health") return json({ status: "ok", service: "becker-juris-supabase" });
  if (path === "/privacy") {
    return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Privacidade - Becker Juris Intelligence</title><body><main><h1>Política de Privacidade</h1><p>O Becker Juris Intelligence processa consultas e documentos para pesquisa jurisprudencial auditável. Documentos, hashes, metadados e trilhas de auditoria são armazenados para garantir rastreabilidade. Os dados não são comercializados.</p><p>Solicitações sobre privacidade devem ser encaminhadas ao responsável pelo Becker Juris Intelligence.</p><p>Última atualização: 19 de junho de 2026.</p></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const principal = { name: "public", role: "user" };

  if (req.method === "GET" && path === "/methodologies") {
    const { data, error } = await supabase.from("bji_methodologies").select("*").eq("active", true);
    return error ? json({ detail: error.message }, 500) : json(data);
  }

  if (req.method === "POST" && path === "/ingest/tjsc") {
    const body = await req.json().catch(() => ({}));
    const query = String(body.query ?? "").trim();
    const methodologyId = String(body.methodology_id ?? "");
    const limit = Math.min(Math.max(Number(body.limit ?? 3), 1), 5);
    if (query.length < 2 || !methodologyId) {
      return json({ detail: "Consulta e metodologia são obrigatórias" }, 422);
    }
    const { data: methodology } = await supabase
      .from("bji_methodologies").select("id").eq("id", methodologyId).eq("active", true).maybeSingle();
    if (!methodology) return json({ detail: "Metodologia não encontrada" }, 404);
    try {
      const documents = await ingestTJSC(supabase, query, limit, methodologyId, principal.name);
      if (!documents.length) return json({ detail: "Nenhum acórdão localizado no TJSC" }, 404);
      return json({
        source: "TJSC_EPROC",
        connector_version: tjscEprocConnectorVersion,
        query,
        captured: documents.length,
        documents,
        citable_after_indexing: true,
      }, 201);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha na captura TJSC";
      return json({ detail: message }, 502);
    }
  }

  if (req.method === "POST" && path === "/ingest/jt") {
    const body = await req.json().catch(() => ({}));
    const query = String(body.query ?? "").trim();
    const methodologyId = String(body.methodology_id ?? "");
    const tribunal = String(body.tribunal ?? "TRT12").trim().toUpperCase();
    const limit = Math.min(Math.max(Number(body.limit ?? 3), 1), 5);
    if (query.length < 2 || !methodologyId) {
      return json({ detail: "Consulta e metodologia são obrigatórias" }, 422);
    }
    const validTribunals = new Set(["TST"]);
    if (!validTribunals.has(tribunal)) {
      return json({ detail: `Tribunal inválido. Por enquanto apenas TST está disponível.` }, 422);
    }
    const { data: methodology } = await supabase
      .from("bji_methodologies").select("id").eq("id", methodologyId).eq("active", true).maybeSingle();
    if (!methodology) return json({ detail: "Metodologia não encontrada" }, 404);
    try {
      const documents = await ingestJT(supabase, query, tribunal, limit, methodologyId, principal.name);
      if (!documents.length) return json({ detail: `Nenhum acórdão localizado no ${tribunal}` }, 404);
      return json({
        source: "JT_JURISPRUDENCIA_NACIONAL",
        connector_version: jtConnectorVersion,
        tribunal,
        query,
        captured: documents.length,
        documents,
        citable_after_indexing: true,
      }, 201);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha na captura JT";
      return json({ detail: message }, 502);
    }
  }

  if (req.method === "POST" && path === "/discover/tjsc") {
    const body = await req.json().catch(() => ({}));
    const query = String(body.query ?? "").trim();
    const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 20);
    if (query.length < 2) return json({ detail: "Consulta obrigatoria" }, 422);

    const requestHash = await sha256(JSON.stringify({ query, limit, source: "DATAJUD_TJSC" }));
    try {
      const discovery = await queryDatajud(query, limit);
      const responseHash = await sha256(JSON.stringify(discovery.results));
      const { data: run, error } = await supabase.from("bji_discovery_runs").insert({
        source: "DATAJUD_TJSC",
        query,
        status: "completed",
        request_hash: requestHash,
        response_hash: responseHash,
        result_count: discovery.results.length,
        results: discovery.results,
        connector_version: datajudConnectorVersion,
        created_by: principal.name,
      }).select("id,captured_at").single();
      if (error) return json({ detail: error.message }, 500);
      return json({
        discovery_run_id: run.id,
        captured_at: run.captured_at,
        source: "DATAJUD_TJSC",
        source_url: datajudTJSCSearch,
        connector_version: datajudConnectorVersion,
        query,
        strategy: discovery.strategy,
        total_reported_by_source: discovery.total,
        results: discovery.results,
        citable: false,
        notice: "Metadados de descoberta. A citacao exige ementa ou inteiro teor obtido e armazenado de fonte oficial.",
        hashes: { request: requestHash, response: responseHash },
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha na consulta DataJud";
      await supabase.from("bji_discovery_runs").insert({
        source: "DATAJUD_TJSC",
        query,
        status: "failed",
        request_hash: requestHash,
        result_count: 0,
        connector_version: datajudConnectorVersion,
        error: message,
        created_by: principal.name,
      });
      return json({ detail: message }, 502);
    }
  }

  if (req.method === "GET" && path.startsWith("/research/")) {
    const artifact = await serializeArtifact(supabase, path.split("/").at(-1) ?? "");
    return artifact ? json(artifact) : json({ detail: "Pesquisa não encontrada" }, 404);
  }

  if (req.method === "POST" && path === "/research/theme") {
    const body = await req.json().catch(() => ({}));
    const query = String(body.query ?? "").trim();
    const methodologyId = String(body.methodology_id ?? "");
    const jurisdiction = normalizeJurisdiction(body.jurisdiction);
    const minDocuments = Math.min(Math.max(Number(body.min_documents ?? 1), 1), 20);
    if (query.length < 2 || !methodologyId) return json({ detail: "Consulta e metodologia são obrigatórias" }, 422);
    const { data: methodology } = await supabase
      .from("bji_methodologies").select("id").eq("id", methodologyId).eq("active", true).maybeSingle();
    if (!methodology) return json({ detail: "Metodologia não encontrada" }, 404);

    const retrievalQuery = expandLegalAcronyms(query);
    const vector = embedding(retrievalQuery);
    const { data: found, error: searchError } = await supabase.rpc("bji_hybrid_search", {
      query_text: retrievalQuery,
      query_embedding: `[${vector.join(",")}]`,
      result_limit: 50,
    });
    if (searchError) return json({ detail: searchError.message }, 500);
    const area = String(body.area ?? "").toLowerCase();
    const trabalhistaCourts = new Set(["TRT12", "TRT4", "TRT9", "TST"]);

    async function runSearch(searchFound: Record<string, unknown>[]) {
      let searchable = searchFound.filter((item: Record<string, unknown>) => {
        if (!item.case_number || !item.content) return false;
        if (area === "trabalhista") {
          const court = String(item.tribunal ?? "").toUpperCase();
          return trabalhistaCourts.has(court) || court.startsWith("TRT");
        }
        return true;
      });
      if (area === "civil" || area === "bancario") {
        searchable = searchable.filter((item: Record<string, unknown>) => {
          const court = String(item.tribunal ?? "").toUpperCase();
          return !court.startsWith("TRT") && court !== "TST";
        });
      }
      if (body.jurisdiction && jurisdiction !== "SC") {
        const allowedCourts = new Set([`TJ${jurisdiction}`, "STJ", "STF"]);
        searchable = searchable.filter((item: Record<string, unknown>) =>
          allowedCourts.has(String(item.tribunal ?? "").toUpperCase())
        );
      }
      searchable.sort((left: Record<string, unknown>, right: Record<string, unknown>) => {
        const priority = courtPriority(left.tribunal, jurisdiction, area) - courtPriority(right.tribunal, jurisdiction, area);
        return priority || Number(right.score_final ?? 0) - Number(left.score_final ?? 0);
      });
      const canonicalDocumentByCase = new Map<string, unknown>();
      for (const item of searchable) {
        const caseKey = `${item.tribunal}|${item.case_number}`;
        if (!canonicalDocumentByCase.has(caseKey)) canonicalDocumentByCase.set(caseKey, item.document_id);
      }
      return canonicalDocumentByCase;
    }

    let allFound = found ?? [];
    let canonicalDocumentByCase = await runSearch(allFound);

    if (canonicalDocumentByCase.size < minDocuments && (area === "civil" || area === "bancario")) {
      try {
        await ingestTJSC(supabase, query, 3, methodologyId, principal.name);
        const { data: refound } = await supabase.rpc("bji_hybrid_search", {
          query_text: retrievalQuery,
          query_embedding: `[${vector.join(",")}]`,
          result_limit: 50,
        });
        allFound = refound ?? [];
        canonicalDocumentByCase = await runSearch(allFound);
      } catch (_) { /* captura falhou, continua com o que tem */ }
    }

    const documentCount = canonicalDocumentByCase.size;
    if (documentCount < minDocuments) return json({ detail: insufficient }, 422);

    const searchable = allFound.filter((item: Record<string, unknown>) => {
      const caseKey = `${item.tribunal}|${item.case_number}`;
      return canonicalDocumentByCase.has(caseKey);
    });
    const supported = searchable.filter((item: Record<string, unknown>) => {
      const caseKey = `${item.tribunal}|${item.case_number}`;
      return canonicalDocumentByCase.get(caseKey) === item.document_id;
    });
    const selected: Record<string, unknown>[] = [];
    const selectedDocuments = new Set<string>();
    for (const item of supported) {
      const documentId = String(item.document_id);
      if (selectedDocuments.has(documentId)) continue;
      selected.push(item);
      selectedDocuments.add(documentId);
      if (selected.length === 3) break;
    }
    const { data: documentRows, error: documentError } = await supabase
      .from("bji_documents")
      .select("id,metadata,procedural_class,publication_date")
      .in("id", [...selectedDocuments]);
    if (documentError) return json({ detail: documentError.message }, 500);
    const documents = new Map<string, Record<string, unknown>>(
      (documentRows ?? []).map((document: Record<string, unknown>) => [String(document.id), document]),
    );
    const ranked = selected.map((item: Record<string, unknown>) => {
      const prepared = { ...item, content: evidenceExcerpt(item.content, query) };
      const document = documents.get(String(item.document_id)) ?? {};
      return { ...prepared, formatted_citation: citationForPetition(prepared, document) };
    });
    Object.assign(ranked[0], buildStructuredArtifacts(ranked, documents));
    const { data: artifactId, error: persistError } = await supabase.rpc("bji_persist_research", {
      p_query: query,
      p_methodology_id: methodologyId,
      p_results: ranked,
      p_created_by: principal.name,
    });
    if (persistError) return json({ detail: persistError.message }, 500);
    const artifact = await serializeArtifact(supabase, artifactId);
    return artifact ? json(artifact, 201) : json({ detail: "Falha ao recuperar artefato" }, 500);
  }

  return json({ detail: "Rota não encontrada" }, 404);
});
