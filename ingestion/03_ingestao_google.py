#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ingestão da BASE DE CONHECIMENTO no Supabase.
Usa Google gemini-embedding-001 (768 dims) via REST direto.
"""
import base64, os, json, sys, time
import requests

EMBED_DIM = 768
EMBED_MODEL = "gemini-embedding-001"
JSONL     = "chunks_base_conhecimento.jsonl"

def chave_supabase_publica(key):
    if key.startswith("sb_publishable_"):
        return True
    if not key.startswith("eyJ"):
        return False
    try:
        payload = key.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return claims.get("role") == "anon"
    except (ValueError, KeyError, json.JSONDecodeError):
        return False

def detectar_modelo_e_versao(api_key):
    """Descobre qual versão de API e modelo funciona com esta chave."""
    versoes  = ["v1beta", "v1"]
    modelos  = [EMBED_MODEL]

    # Dois estilos de autenticação: query param e header (novo padrão AQ.)
    def fazer_req(url, body, key):
        # Tenta header x-goog-api-key (novo padrão)
        r = requests.post(url, headers={"Content-Type": "application/json", "x-goog-api-key": key}, json=body, timeout=15)
        if r.status_code == 200:
            return r, "header"
        # Tenta ?key= (padrão antigo)
        r2 = requests.post(url, params={"key": key}, headers={"Content-Type": "application/json"}, json=body, timeout=15)
        if r2.status_code == 200:
            return r2, "queryparam"
        return r2, None  # retorna último erro

    for versao in versoes:
        for modelo in modelos:
            url  = f"https://generativelanguage.googleapis.com/{versao}/models/{modelo}:embedContent"
            body = {
                "model": f"models/{modelo}",
                "content": {"parts": [{"text": "teste"}]},
                "taskType": "RETRIEVAL_DOCUMENT",
                "outputDimensionality": EMBED_DIM,
            }
            resp, auth_style = fazer_req(url, body, api_key)
            if auth_style:
                print(f"  Funcionou: versão={versao} modelo={modelo} auth={auth_style}")
                return versao, modelo, auth_style
            else:
                print(f"  {versao}/{modelo}: {resp.status_code} — {resp.json().get('error',{}).get('message','')[:80]}")

    return None, None, None

def embed_text(text, api_key, versao, modelo, auth_style):
    url  = f"https://generativelanguage.googleapis.com/{versao}/models/{modelo}:embedContent"
    body = {
        "model": f"models/{modelo}",
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": EMBED_DIM,
    }
    if auth_style == "header":
        resp = requests.post(url, headers={"Content-Type": "application/json", "x-goog-api-key": api_key}, json=body, timeout=30)
    else:
        resp = requests.post(url, params={"key": api_key}, headers={"Content-Type": "application/json"}, json=body, timeout=30)

    resp.raise_for_status()
    return resp.json()["embedding"]["values"]

def main():
    try:
        from supabase import create_client
    except ImportError:
        sys.exit("Instale: pip install requests supabase")

    g_key  = os.environ.get("GOOGLE_API_KEY")
    sb_url = os.environ.get("SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (g_key and sb_url and sb_key):
        sys.exit("Defina GOOGLE_API_KEY, SUPABASE_URL e SUPABASE_SERVICE_KEY.")
    if chave_supabase_publica(sb_key):
        sys.exit(
            "SUPABASE_SERVICE_KEY precisa ser uma chave secreta/service_role, "
            "nao uma chave publishable/anon. Gere uma chave sb_secret_ no painel do Supabase."
        )

    print("Detectando configuração da API Google...")
    versao, modelo, auth_style = detectar_modelo_e_versao(g_key)
    if not versao:
        sys.exit("\nNenhuma combinação funcionou. Verifique se a chave está correta.")

    print(f"\nUsando: {versao} / {modelo} / auth={auth_style}")

    # Verifica dimensão do modelo encontrado
    v_teste = embed_text("teste de dimensão", g_key, versao, modelo, auth_style)
    dim_real = len(v_teste)
    print(f"Dimensão do embedding: {dim_real}")
    if dim_real != EMBED_DIM:
        print(f"ATENÇÃO: dimensão {dim_real} != {EMBED_DIM}. Ajuste o schema se necessário.")

    sb = create_client(sb_url, sb_key)
    rows = [json.loads(l) for l in open(JSONL, encoding="utf-8")]
    total_chunks = len(rows)
    print(f"\n{total_chunks} chunks a ingerir.")
    print(f"Tempo estimado: ~{int(total_chunks / 80) + 1} minuto(s).\n")

    BATCH = 20
    total = 0

    for i in range(0, total_chunks, BATCH):
        batch  = rows[i:i+BATCH]
        inputs = [f"[{r.get('materia') or r['pasta']} | {r['secao']}] {r['conteudo']}" for r in batch]

        vectors = []
        for text in inputs:
            for tentativa in range(3):
                try:
                    v = embed_text(text, g_key, versao, modelo, auth_style)
                    vectors.append(v)
                    break
                except Exception as e:
                    if tentativa < 2:
                        print(f"  Tentativa {tentativa+1}/3 falhou: {e}. Aguardando 10s...")
                        time.sleep(10)
                    else:
                        print(f"  Pulando chunk.")
                        vectors.append(None)
            time.sleep(0.75)

        payload = []
        for r, v in zip(batch, vectors):
            if v is None:
                continue
            payload.append({
                "chunk_id": r["chunk_id"], "pasta": r["pasta"], "arquivo": r["arquivo"],
                "titulo_documento": r.get("titulo_documento"), "secao": r.get("secao"),
                "materia": r.get("materia"), "tipo_peca": r.get("tipo_peca"),
                "nivel_importancia": r.get("nivel_importancia"), "frequencia": r.get("frequencia"),
                "palavras_chave": r.get("palavras_chave"), "lacuna": r.get("lacuna", False),
                "conteudo": r["conteudo"], "tokens_aprox": r.get("tokens_aprox"), "embedding": v,
            })

        if payload:
            sb.table("base_conhecimento").upsert(payload, on_conflict="chunk_id").execute()
        total += len(payload)
        print(f"  {total}/{total_chunks} chunks inseridos...")

    print(f"\nOK — {total} chunks na base_conhecimento.")

if __name__ == "__main__":
    main()
