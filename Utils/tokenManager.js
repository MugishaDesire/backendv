const axios = require("axios");

let tokenData = { access: null, refresh: null, expiresAt: null };

async function authenticate() {
  const res = await axios.post(
    `${process.env.PAYPACK_BASE_URL}/auth/agents/authorize`,
    {
      client_id: process.env.PAYPACK_CLIENT_ID,
      client_secret: process.env.PAYPACK_CLIENT_SECRET,
    },
    { headers: { "Content-Type": "application/json", Accept: "application/json" } }
  );
  tokenData.access    = res.data.access;
  tokenData.refresh   = res.data.refresh;
  tokenData.expiresAt = Date.now() + 14 * 60 * 1000;
  return tokenData.access;
}

async function refreshToken() {
  const res = await axios.get(
    `${process.env.PAYPACK_BASE_URL}/auth/agents/refresh/${tokenData.refresh}`,
    { headers: { Accept: "application/json" } }
  );
  tokenData.access    = res.data.access;
  tokenData.refresh   = res.data.refresh;
  tokenData.expiresAt = Date.now() + 14 * 60 * 1000;
  return tokenData.access;
}

async function getAccessToken() {
  if (!tokenData.access)              return await authenticate();
  if (Date.now() >= tokenData.expiresAt) return await refreshToken();
  return tokenData.access;
}

module.exports = { getAccessToken };