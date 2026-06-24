#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ingestao da base auditada 2026 no Supabase.

Variaveis obrigatorias:
  GOOGLE_API_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_KEY

Arquivo padrao:
  chunks_base_conhecimento_auditada_2026.jsonl
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from pathlib import Path

import requests


EMBED_DIM = 768
EMBED_MODEL = "gemini-embedding-001"
JSONL = os.environ.get("JSONL_AUDITADA", "chunks_base_conhecimento_auditada_2026.jsonl")


def chave_supabase_publica(key: str) -> bool:
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


def detectar_modelo_e_versao(api_key: str):
    versoes = ["v1beta", "v1"]
    modelos = [EMBED_MODEL]

    def fazer_req(url: str, body: dict, key: str):
        r = requests.post(
            url,
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
            json=body,
            timeout=15,
        )
        if r.status_code == 200:
            return r, "header"
        r2 = requests.post(
            url,
            params={"key": key},
            headers={"Content-Type": "application/json"},
            json=body,
            timeout=15,
        )
        if r2.status_code == 200:
            return r2, "queryparam"
        return r2, None

    for versao in versoes:
        for modelo in modelos:
            url = f"https://generativelanguage.googleapis.com/{versao}/models/{modelo}:embedContent"
            body = {
                "model": f"models/{modelo}",
                "content": {"parts": [{"text": "teste"}]},
                "taskType": "RETRIEVAL_DOCUMENT",
                "outputDimensionality": EMBED_DIM,
            }
            resp, auth_style = fazer_req(url, body, api_key)
            if auth_style:
                print(f"  Funcionou: versao={versao} modelo={modelo} auth={auth_style}")
                return versao, modelo, auth_style
            try:
                msg = resp.json().get("error", {}).get("message", "")
            except Exception:
                msg = resp.text
            print(f"  {versao}/{modelo}: {resp.status_code} - {msg[:80]}")
    return None, None, None


def embed_text(text: str, api_key: str, versao: str, modelo: str, auth_style: str):
    url = f"https://generativelanguage.googleapis.com/{versao}/models/{modelo}:embedContent"
    body = {
        "model": f"models/{modelo}",
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": EMBED_DIM,
    }
    if auth_style == "header":
        resp = requests.post(
            url,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            json=body,
            timeout=30,
        )
    else:
        resp = requests.post(
            url,
            params={"key": api_key},
            headers={"Content-Type": "application/json"},
            json=body,
            timeout=30,
        )
    resp.raise_for_status()
    return resp.json()["embedding"]["values"]


def main() -> None:
    try:
        from supabase import create_client
    except ImportError:
        sys.exit("Instale: python -m pip install requests supabase")

    g_key = os.environ.get("GOOGLE_API_KEY")
    sb_url = os.environ.get("SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (g_key and sb_url and sb_key):
        sys.exit("Defina GOOGLE_API_KEY, SUPABASE_URL e SUPABASE_SERVICE_KEY.")
    if chave_supabase_publica(sb_key):
        sys.exit("SUPABASE_SERVICE_KEY precisa ser secret/service_role, nao publishable/anon.")

    path = Path(JSONL)
    if not path.exists():
        sys.exit(f"Arquivo nao encontrado: {path}")

    print("Detectando configuracao da API Google...")
    versao, modelo, auth_style = detectar_modelo_e_versao(g_key)
    if not versao:
        sys.exit("Nenhuma combinacao do Google funcionou. Confira a chave.")

    print(f"\nUsando: {versao} / {modelo} / auth={auth_style}")
    dim_real = len(embed_text("teste de dimensao", g_key, versao, modelo, auth_style))
    print(f"Dimensao do embedding: {dim_real}")
    if dim_real != EMBED_DIM:
        sys.exit(f"Dimensao inesperada: {dim_real}, esperado {EMBED_DIM}.")

    rows = [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]
    print(f"\n{len(rows)} chunks auditados a ingerir.")
    if len(rows) != 70:
        print("ATENCAO: esperado 70 chunks; continuando porque o JSONL pode ter sido atualizado.")

    sb = create_client(sb_url, sb_key)

    print("Limpando versoes AUD2026 antigas...")
    sb.table("base_conhecimento").delete().like("chunk_id", "AUD2026-%").execute()

    batch_size = 20
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        payload = []
        for r in batch:
            text = f"[{r.get('materia')} | {r.get('secao')}] {r['conteudo']}"
            vector = None
            for tentativa in range(3):
                try:
                    vector = embed_text(text, g_key, versao, modelo, auth_style)
                    break
                except Exception as exc:
                    if tentativa < 2:
                        print(f"  Tentativa {tentativa + 1}/3 falhou: {exc}. Aguardando 10s...")
                        time.sleep(10)
                    else:
                        print(f"  Pulando {r['chunk_id']}: {exc}")
            time.sleep(0.75)
            if vector is None:
                continue
            payload.append({
                "chunk_id": r["chunk_id"],
                "pasta": r["pasta"],
                "arquivo": r["arquivo"],
                "titulo_documento": r.get("titulo_documento"),
                "secao": r.get("secao"),
                "materia": r.get("materia"),
                "tipo_peca": r.get("tipo_peca"),
                "nivel_importancia": r.get("nivel_importancia"),
                "frequencia": r.get("frequencia"),
                "palavras_chave": r.get("palavras_chave"),
                "lacuna": r.get("lacuna", False),
                "conteudo": r["conteudo"],
                "tokens_aprox": r.get("tokens_aprox"),
                "embedding": vector,
            })
        if payload:
            sb.table("base_conhecimento").upsert(payload, on_conflict="chunk_id").execute()
        total += len(payload)
        print(f"  {total}/{len(rows)} chunks auditados inseridos...")

    print(f"\nOK - {total} chunks AUD2026 na base_conhecimento.")


if __name__ == "__main__":
    main()
