import jwt from 'jsonwebtoken'

const DEFAULT_SIG = process.env.SIGN_IN_TOKEN_SECRET;
const DEFAULT_TTL = process.env.ACCESS_TOKEN_TTL || '30d'; 

// ========================= generation ==============================
export const generateToken = ({
payload = {},
signature = DEFAULT_SIG,
expiresIn = DEFAULT_TTL,
} = {}) => {
  // check if the payload is empty object
if (!Object.keys(payload).length) {
    return false
}
const token = jwt.sign(payload, signature, { expiresIn })
return token
}

// =========================  Verify ==============================
export const verifyToken = ({
token = '',
signature = DEFAULT_SIG,
} = {}) => {
  // check if the payload is empty object
if (!token) {
    return false
}
const data = jwt.verify(token, signature)
return data
}