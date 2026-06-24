#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera um JSONL importavel para base_conhecimento a partir dos lotes auditados.

Saida:
  chunks_base_conhecimento_auditada_2026.jsonl
"""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RESP = ROOT / "LOTES_PARA_AUDITORIA_GPT" / "RESPOSTAS_AUDITADAS"
OUT = ROOT / "chunks_base_conhecimento_auditada_2026.jsonl"

INPUTS = [
    ("01_FUNDAMENTOS_BUSCA_REVISIONAL_FRAUDES_AUDITADO_COMPLETO.jsonl", "FUNDAMENTOS_BUSCA_REVISIONAL_FRAUDES"),
    ("02_RMC_RCC_E_SUPERENDIVIDAMENTO_AUDITADO.jsonl", "RMC_RCC_SUPERENDIVIDAMENTO"),
    ("03_CALCULOS_E_PROVAS_DIGITAIS_AUDITADO.jsonl", "CALCULOS_PROVAS_DIGITAIS"),
    ("04_JURISPRUDENCIA_PARTE_1_PARCIAL.jsonl", "JURISPRUDENCIA_PARTE_1"),
    ("04_JV010_CONFERENCIA_JUSBRASIL_A_VERIFICAR.jsonl", "JURISPRUDENCIA_PARTE_1"),
    ("05_JURISPRUDENCIA_PARTE_2_AUDITADO.jsonl", "JURISPRUDENCIA_PARTE_2"),
]

TEMA_POR_PREFIXO = {
    "LEG": "Fundamentos legais bancarios/consumidor",
    "BA": "Busca e apreensao e alienacao fiduciaria",
    "REV": "Acoes revisionais bancarias",
    "FR": "Fraudes bancarias e engenharia social",
    "RMC": "RMC/RCC e cartao consignado",
    "SE": "Superendividamento",
    "CA": "Calculos bancarios",
    "PD": "Provas digitais",
    "JV": "Jurisprudencia bancaria",
    "AV": "Jurisprudencia auxiliar e avisos",
}

IMPORTANCIA = {
    "ALTA": "ALTO",
    "MEDIA-ALTA": "ALTO",
    "MÉDIA-ALTA": "ALTO",
    "MEDIA": "MÉDIO",
    "MÉDIA": "MÉDIO",
}


def read_jsonl(path: Path):
    with path.open("r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line.startswith("{"):
                yield json.loads(line)


def prefix(chunk_id: str) -> str:
    return chunk_id.split("-", 1)[0]


def materia(chunk_id: str) -> str:
    return TEMA_POR_PREFIXO.get(prefix(chunk_id), "Direito bancario")


def tipo_peca(chunk_id: str) -> str:
    p = prefix(chunk_id)
    if p in {"JV", "AV"}:
        return "JURISPRUDENCIA"
    if p in {"CA"}:
        return "CALCULOS"
    if p in {"PD"}:
        return "PROVA_DIGITAL"
    return "TESES"


def nivel(conf: str | None) -> str:
    return IMPORTANCIA.get((conf or "").upper(), "ALTO")


def status_publicacao(resultado: str) -> str:
    res = (resultado or "").upper()
    if res == "CONFIRMADO":
        return "CONFERIDO_IA"
    if res == "CONFIRMADO_COM_AJUSTES":
        return "CONFERIDO_IA_COM_AJUSTES"
    if res == "CORRIGIR":
        return "CORRIGIDO_NA_BASE"
    if "PESQUISA" in res:
        return "PESQUISA_AUXILIAR"
    return "CONFERIDO_IA"


def conteudo_final(r: dict) -> str:
    res = (r.get("resultado_auditoria") or "").upper()
    partes = [
        f"ID: {r.get('chunk_id')}",
        f"Status editorial: {status_publicacao(r.get('resultado_auditoria'))}",
        f"Resultado da conferencia: {r.get('resultado_auditoria') or 'CONFERIDO_IA'}",
        f"Fonte informada: {r.get('fonte_oficial') or ''}",
        "",
    ]

    if res == "CORRIGIR":
        partes.extend([
            "ATENCAO - ERRO A EVITAR:",
            r.get("divergencias") or "Havia simplificacao ou atribuicao incorreta no material anterior.",
            "",
            "TESE CORRIGIDA PARA USO:",
        ])
    elif r.get("divergencias"):
        partes.extend([
            "AJUSTES/RESSALVAS TECNICAS:",
            r.get("divergencias") or "",
            "",
            "TESE PARA USO COM RESSALVAS:",
        ])
    else:
        partes.append("TESE PARA USO:")

    partes.extend([
        r.get("texto_oficial") or "",
        "",
        "RESUMO TECNICO:",
        r.get("resumo_tecnico") or "",
        "",
        "APLICACAO PRATICA:",
        r.get("aplicacao_pratica") or "",
        "",
        "REGRA DE USO PELO GPT:",
        "Use como apoio tecnico. Nao invente numero de processo, relator, data ou ementa. "
        "Se precisar citar jurisprudencia especifica em peca, confirmar no STJ/STF/TJ antes de protocolar.",
    ])
    return "\n".join(partes).strip()


def main() -> None:
    rows = []
    seen = set()

    for filename, bloco in INPUTS:
        path = RESP / filename
        if not path.exists():
            raise FileNotFoundError(path)
        for r in read_jsonl(path):
            cid = r["chunk_id"]
            if cid in seen:
                raise ValueError(f"chunk_id duplicado: {cid}")
            seen.add(cid)
            rows.append({
                "chunk_id": f"AUD2026-{cid}",
                "pasta": "AUDITORIA_2026",
                "arquivo": filename,
                "titulo_documento": f"Base auditada 2026 - {bloco}",
                "secao": cid,
                "materia": materia(cid),
                "tipo_peca": tipo_peca(cid),
                "nivel_importancia": nivel(r.get("confianca_auditoria")),
                "frequencia": status_publicacao(r.get("resultado_auditoria")),
                "palavras_chave": " ".join([
                    cid,
                    materia(cid),
                    r.get("resultado_auditoria") or "",
                    r.get("fonte_oficial") or "",
                ]),
                "lacuna": False,
                "conteudo": conteudo_final(r),
                "tokens_aprox": max(1, len(conteudo_final(r).split())),
            })

    rows.sort(key=lambda x: x["chunk_id"])
    if len(rows) != 70:
        raise ValueError(f"Esperado 70 registros, gerado {len(rows)}")

    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"OK - {len(rows)} registros gerados em {OUT}")


if __name__ == "__main__":
    main()
