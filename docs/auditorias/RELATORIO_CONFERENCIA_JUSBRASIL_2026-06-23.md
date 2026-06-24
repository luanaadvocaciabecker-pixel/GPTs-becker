# Relatorio de Conferencia - Jusbrasil / GPT Bancario

Data: 2026-06-23

## Conclusao curta

O material recebido ajuda bastante como conferencia auxiliar, mas nao autoriza marcar a base como `VERIFICADO`.

Motivo: a maior parte das fontes apontadas sao Jusbrasil ou mencoes genericas a julgados/leis. Para a Supabase final, o ideal continua sendo confirmar lei no Planalto e jurisprudencia diretamente no STJ/STF/TJSC, quando possivel.

## Resultado geral por bloco

### Bloco 1 - Fundamentos, busca e apreensao, revisional e fraudes

Status: util, mas incompleto para verificacao item a item.

Pontos bons:

- `LEG-002`: confirmado com ajustes. CDC art. 14 e responsabilidade objetiva, com ressalva sobre culpa exclusiva da vitima.
- `LEG-003`: confirmado. CDC art. 39 usado para praticas abusivas.
- `LEG-004`: confirmado com ajustes. Repeticao do indebito e evolucao do STJ apos EAREsp 600.663/RS e 676.608/RS, com atencao a modulacao a partir de 30/03/2021.
- `LEG-005`: confirmado. CDC art. 52 e dever de informacao em credito.
- `LEG-006`: confirmado. Lei 14.181/2021 e superendividamento.
- `LEG-007` a `LEG-010` e `BA`: confirmados com ajustes em bloco, especialmente Tema 1132/STJ, notificacao e distincao entre bens moveis e imoveis.
- `REV` e `FR`: confirmados com ajustes em bloco.

Problemas:

- `LEG-001` nao apareceu na analise recebida.
- Muitos itens foram analisados em bloco, sem resultado individual para cada ID.
- Fontes vieram em grande parte por Jusbrasil, nao por fonte oficial direta.

### Bloco 2 - RMC/RCC e superendividamento

Status: bom para orientar correcao.

Resultados principais:

- `RMC-001`: confirmado com ajustes. Lei 10.820/2003 e margem consignavel, com alerta de volatilidade dos percentuais.
- `RMC-002`: corrigir. Tema 1085/STJ nao trata de RMC/RCC; trata de emprestimos comuns com desconto em conta-corrente.
- `RMC-003`: confirmado. Vicio de consentimento em RMC/RCC.
- `RMC-004` e `SE-001`: confirmados com ajustes. Superendividamento e minimo existencial nao equivalem automaticamente a um salario minimo liquido.
- `SE-002`: confirmado. CDC arts. 104-A a 104-C.
- `SE-003` e `SE-004`: confirmados. Dignidade da pessoa humana e deveres do fornecedor no credito.

### Bloco 3 - Calculos e provas digitais

Status: bom para orientar correcao.

Resultados principais:

- `CA-001`: confirmado com ajustes. MP 2.170-36/2001 e capitalizacao inferior a anual, desde que pactuada.
- `CA-002` e `CA-003`: confirmados com ajustes. SAC, Price e CET exigem analise tecnica.
- `CA-004` e `CA-005`: corrigir. Tema 810/STF nao se aplica diretamente a contratos bancarios privados; trata de Fazenda Publica.
- `CA-006` e `PD-004`: confirmados. Prova pericial e CPC.
- `PD-001` e `PD-002`: corrigir. Marco Civil diferencia guarda de registros de conexao por 1 ano e registros de aplicacao por 6 meses.
- `PD-003`: confirmado. Ata notarial e CPC art. 384, com ressalva de que "mais robusto" e opinativo.

### Bloco 4 - Jurisprudencia parte 1

Status: util, e trouxe o item que faltava (`JV-010`).

Resultados principais:

- `JV-001`: confirmado. Sumula 297/STJ.
- `JV-002`: confirmado. Sumula 530/STJ.
- `JV-003`: confirmado. Sumula 541/STJ.
- `JV-004`: confirmado. Sumula 548/STJ.
- `JV-005`: confirmado. Sumula 550/STJ.
- `JV-006` e `JV-009`: corrigir. Ha mistura entre Tema 620/Sumula 566, Tema 958 e possivel erro de numeracao de sumula.
- `JV-007`: confirmado. Sumula 472/STJ.
- `JV-008`: confirmado com ajustes. Sumula 385/STJ, com ressalva sobre flexibilizacao.
- `JV-010`: pesquisa realizada. Tema central: Sumula 479/STJ, responsabilidade objetiva por fortuito interno em fraudes bancarias, com distincao entre falha do banco e culpa exclusiva da vitima em engenharia social.
- `JV-011` e `JV-012`: confirmado/corrigir conforme uso. Tema 1085 confirmado no contexto correto, mas nao para RMC.

### Bloco 5 - Jurisprudencia parte 2

Status: bom para orientar correcao.

Resultados principais:

- `JV-013`: confirmado. Tema 1132/STJ.
- `AV-001` e `AV-002`: confirmados. Sumulas 296 e 294/STJ.
- `AV-003`: confirmado com ressalva. Tema 1249/STF tem repercussao geral, mas esta pendente de julgamento de merito; nao ha tese vinculante firmada.
- `AV-004`: corrigir. Tema 204/STF nao trata de fortuito interno; houve confusao com Sumula 479/STJ.
- `AV-005` a `AV-009`: confirmados com ajustes. Existem tendencias no TJSC, mas nao podem ser citadas como "teses oficiais" sem acordao especifico, sumula ou IRDR.
- `AV-010`: corrigir. Tema 1112/STJ foi cancelado em marco de 2022 pela superveniencia da Lei 14.181/2021.

## O que muda no nosso controle

1. `JV-010` deixou de estar totalmente ausente, mas ainda deve ficar `A_VERIFICAR`, porque a conferencia veio por Jusbrasil e mencoes gerais.
2. Nao marcar nenhum registro como `VERIFICADO` ainda.
3. Usar este material para corrigir a redacao tecnica dos itens.
4. Para subida na Supabase, manter filtro para nao retornar `A_VERIFICAR` como verdade final.

## Pendencias objetivas

- Confirmar `LEG-001`, porque nao apareceu no retorno.
- Separar os itens analisados em bloco, principalmente:
  - `LEG-007` a `LEG-010`
  - `BA-001` a `BA-006`
  - `REV-001` a `REV-007`
  - `FR-001` a `FR-006`
- Conferir diretamente em fonte oficial:
  - Sumulas STJ: 294, 296, 297, 385, 472, 479, 530, 541, 548, 550, 566.
  - Temas STJ: 620, 953, 958, 973, 1085, 1132.
  - Tema STF 1249.
  - Tema STF 204, apenas para confirmar que nao tem relacao com fortuito interno.
  - Tema STJ 1112, para confirmar cancelamento.

## Registro `JV-010` sugerido para controle

```jsonl
{"chunk_id":"JV-010","status_verificacao":"A_VERIFICAR","fonte_oficial":"https://scon.stj.jus.br/SCON/sumstj/toc.jsp","resultado_auditoria":"CONFIRMADO_COM_AJUSTES","divergencias":"A pesquisa aponta a Sumula 479/STJ como fundamento central da responsabilidade objetiva das instituicoes financeiras por fortuito interno em fraudes bancarias. Contudo, a aplicacao deve distinguir fraude ligada a falha de seguranca/risco da atividade e casos de engenharia social com possivel culpa exclusiva da vitima. A fonte recebida foi Jusbrasil, nao fonte oficial direta do STJ.","texto_oficial":"As instituicoes financeiras respondem objetivamente pelos danos gerados por fortuito interno relativo a fraudes e delitos praticados por terceiros no ambito de operacoes bancarias.","resumo_tecnico":"A Sumula 479/STJ e o eixo da responsabilidade bancaria por fraudes como fortuito interno, mas a jurisprudencia recente exige analise do caso concreto, especialmente em golpes de engenharia social.","aplicacao_pratica":"Usar em casos de fraude bancaria quando houver indicios de falha de seguranca, vazamento de dados, operacao atipica nao bloqueada ou risco inerente ao servico bancario. Evitar aplicacao automatica quando houver entrega voluntaria de senha/dados pela vitima sem falha demonstrada do banco.","confianca_auditoria":"MEDIA-ALTA"}
```

