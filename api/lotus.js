// api/lotus.js
// Função serverless (Vercel) — "porta de entrada" do Higienizador FGTS.
//
// IMPORTANTE / SEGURANÇA:
// - A chave da API fica SOMENTE aqui no servidor (variáveis de ambiente da Vercel),
//   nunca no navegador do cliente.
// - Esta função SÓ CONSULTA / SIMULA. Ela NÃO cria proposta em hipótese alguma.
// - Ela foi feita para falar com a API OFICIAL de parceiro da Lotus. Enquanto a Lotus
//   não liberar essa API + chave, a função responde "não configurada" e o painel
//   mostra isso de forma clara. Nenhuma trava de segurança da Lotus é contornada aqui.
//
// Variáveis de ambiente esperadas (configurar na Vercel quando a Lotus liberar):
//   LOTUS_API_BASE   -> ex.: https://api.parceiro.lotusmais.com.br
//   LOTUS_API_KEY    -> a chave/token oficial de parceiro
//   LOTUS_CONSULTA_PATH (opcional) -> caminho da consulta. padrão: /v1/fgts/consulta

const DEFAULT_PATH = process.env.LOTUS_CONSULTA_PATH || "/v1/fgts/consulta";
const MAX_CPFS_POR_REQUISICAO = 10; // o painel manda em lotes pequenos p/ mostrar progresso

function soDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

// Tenta extrair saldo/nome/telefone de formatos comuns de resposta,
// pra funcionar com pequenas variações da API oficial sem precisar reescrever.
function normalizar(cpf, dados) {
  const c = dados?.customer || dados?.cliente || dados || {};
  const sim = dados?.simulation || dados?.simulacao || {};
  const saldo =
    dados?.saldo ??
    dados?.totalTransfer ??
    sim?.totalTransfer ??
    sim?.saldo ??
    dados?.availableBalance ??
    0;
  return {
    cpf,
    status: dados?.status || dados?.situacao || "COMPLETED",
    saldo: Number(saldo) || 0,
    nome: c?.name || c?.nome || dados?.name || "",
    telefone: c?.phone || c?.telefone || dados?.phone || "",
    email: c?.email || dados?.email || "",
    mensagem: dados?.message || dados?.mensagem || "",
  };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const base = process.env.LOTUS_API_BASE;
  const key = process.env.LOTUS_API_KEY;

  // Ainda sem API oficial configurada -> avisa de forma clara (não é erro de bug).
  if (!base || !key) {
    res.status(503).json({
      configured: false,
      message:
        "A API oficial da Lotus ainda não está configurada. Assim que você receber " +
        "a documentação e a chave de parceiro, basta cadastrar LOTUS_API_BASE e " +
        "LOTUS_API_KEY nas variáveis de ambiente da Vercel que o higienizador passa a funcionar.",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const cpfs = Array.isArray(body?.cpfs) ? body.cpfs.map(soDigitos).filter(Boolean) : [];
  if (!cpfs.length) {
    res.status(400).json({ error: "Envie ao menos um CPF em 'cpfs'." });
    return;
  }
  if (cpfs.length > MAX_CPFS_POR_REQUISICAO) {
    res.status(400).json({ error: `Máximo de ${MAX_CPFS_POR_REQUISICAO} CPFs por requisição.` });
    return;
  }

  const opcoes = {
    numberOfPeriods: Number(body?.numberOfPeriods) || 12,
    reservationAmount: Number(body?.reservationAmount) || 50,
    hasInsurance: Boolean(body?.hasInsurance),
    useProvider: body?.provider || "CARTOS_V2",
  };

  const url = base.replace(/\/+$/, "") + DEFAULT_PATH;
  const resultados = [];

  for (const cpf of cpfs) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ cpf, ...opcoes }),
      });

      const txt = await r.text();
      let data;
      try { data = JSON.parse(txt); } catch { data = { message: txt }; }

      if (!r.ok) {
        resultados.push({
          cpf,
          status: "ERRO",
          saldo: 0,
          nome: "",
          telefone: "",
          email: "",
          mensagem: data?.message || data?.error || `HTTP ${r.status}`,
        });
      } else {
        resultados.push(normalizar(cpf, data));
      }
    } catch (e) {
      resultados.push({
        cpf,
        status: "ERRO",
        saldo: 0,
        nome: "",
        telefone: "",
        email: "",
        mensagem: e?.message || "Falha na requisição",
      });
    }
  }

  res.status(200).json({ configured: true, resultados });
}
