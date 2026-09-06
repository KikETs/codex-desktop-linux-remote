// TPM-backed P-256 key provider. No persistent handles, NV writes, clear,
// hierarchy changes, import, duplicate, or plaintext private-key export.
#include <tss2/tss2_esys.h>
#include <tss2/tss2_mu.h>
#include <tss2/tss2_tctildr.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

static void check(TSS2_RC rc, const char* op) {
    if (rc) {
        char hex[16]; snprintf(hex, sizeof(hex), "0x%08x", rc);
        throw std::runtime_error(std::string(op) + ": " + hex);
    }
}
template <typename T> struct Owned {
    T* p = nullptr;
    ~Owned() { Esys_Free(p); }
};
struct TPM {
    TSS2_TCTI_CONTEXT* tcti = nullptr;
    ESYS_CONTEXT* esys = nullptr;
    ESYS_TR primary = ESYS_TR_NONE, child = ESYS_TR_NONE;
    ~TPM() {
        if (esys) {
            if (child != ESYS_TR_NONE) Esys_FlushContext(esys, child);
            if (primary != ESYS_TR_NONE) Esys_FlushContext(esys, primary);
            Esys_Finalize(&esys);
        }
        Tss2_TctiLdr_Finalize(&tcti);
    }
    void connect() {
#ifdef RC_TEST_TPM
        const char* transport = getenv("RC_TEST_TCTI");
        if (!transport || strncmp(transport, "swtpm:", 6))
            throw std::runtime_error("test build requires explicit swtpm transport");
#else
        // Never accept a userspace simulator or env-selected TCTI in production.
        const char* transport = "device:/dev/tpmrm0";
        if (access("/dev/tpmrm0", R_OK | W_OK))
            throw std::runtime_error("TPM_ACCESS_REQUIRED: user cannot open /dev/tpmrm0; no software fallback");
#endif
        check(Tss2_TctiLdr_Initialize(transport, &tcti), "TCTI initialize");
        check(Esys_Initialize(&esys, tcti, nullptr), "ESAPI initialize");
    }
    void makePrimary() {
        TPM2B_SENSITIVE_CREATE sensitive{};
        TPM2B_PUBLIC pub{};
        pub.publicArea.type = TPM2_ALG_ECC;
        pub.publicArea.nameAlg = TPM2_ALG_SHA256;
        pub.publicArea.objectAttributes = TPMA_OBJECT_FIXEDTPM | TPMA_OBJECT_FIXEDPARENT |
            TPMA_OBJECT_SENSITIVEDATAORIGIN | TPMA_OBJECT_USERWITHAUTH |
            TPMA_OBJECT_NODA | TPMA_OBJECT_RESTRICTED | TPMA_OBJECT_DECRYPT;
        auto& p = pub.publicArea.parameters.eccDetail;
        p.symmetric.algorithm = TPM2_ALG_AES;
        p.symmetric.keyBits.aes = 128;
        p.symmetric.mode.aes = TPM2_ALG_CFB;
        p.scheme.scheme = TPM2_ALG_NULL;
        p.curveID = TPM2_ECC_NIST_P256;
        p.kdf.scheme = TPM2_ALG_NULL;
        TPM2B_DATA outside{}; TPML_PCR_SELECTION pcr{};
        Owned<TPM2B_PUBLIC> result; Owned<TPM2B_CREATION_DATA> creation;
        Owned<TPM2B_DIGEST> hash; Owned<TPMT_TK_CREATION> ticket;
        check(Esys_CreatePrimary(esys, ESYS_TR_RH_OWNER, ESYS_TR_PASSWORD,
            ESYS_TR_NONE, ESYS_TR_NONE, &sensitive, &pub, &outside, &pcr,
            &primary, &result.p, &creation.p, &hash.p, &ticket.p), "CreatePrimary");
    }
};
static std::string hex(const uint8_t* data, size_t size) {
    static const char* digits = "0123456789abcdef";
    std::string s; s.reserve(2 * size);
    for (size_t i = 0; i < size; ++i) { s += digits[data[i] >> 4]; s += digits[data[i] & 15]; }
    return s;
}
static std::vector<uint8_t> readHex() {
    std::string line;
    // Fixed bound: reject oversized inputs before allocating arbitrarily.
    char c;
    while (std::cin.get(c) && c != '\n') {
        if (line.size() >= 16384) throw std::runtime_error("input too large");
        line += c;
    }
    if (line.empty() || line.size() % 2) throw std::runtime_error("invalid hex input");
    auto nibble = [](char x) -> int {
        if (x >= '0' && x <= '9') return x - '0';
        if (x >= 'a' && x <= 'f') return x - 'a' + 10;
        throw std::runtime_error("noncanonical hex input");
    };
    std::vector<uint8_t> bytes;
    for (size_t i = 0; i < line.size(); i += 2)
        bytes.push_back(static_cast<uint8_t>((nibble(line[i]) << 4) | nibble(line[i + 1])));
    return bytes;
}
static constexpr TPMA_OBJECT attributes = TPMA_OBJECT_FIXEDTPM | TPMA_OBJECT_FIXEDPARENT |
    TPMA_OBJECT_SENSITIVEDATAORIGIN | TPMA_OBJECT_USERWITHAUTH | TPMA_OBJECT_NODA |
    TPMA_OBJECT_SIGN_ENCRYPT;
static void validate(const TPM2B_PUBLIC& pub) {
    const auto& a = pub.publicArea;
    const auto& p = a.parameters.eccDetail;
    if (a.type != TPM2_ALG_ECC || a.nameAlg != TPM2_ALG_SHA256 ||
        a.objectAttributes != attributes || a.authPolicy.size != 0 ||
        p.curveID != TPM2_ECC_NIST_P256 || p.symmetric.algorithm != TPM2_ALG_NULL ||
        p.scheme.scheme != TPM2_ALG_ECDSA || p.scheme.details.ecdsa.hashAlg != TPM2_ALG_SHA256 ||
        p.kdf.scheme != TPM2_ALG_NULL || a.unique.ecc.x.size != 32 || a.unique.ecc.y.size != 32)
        throw std::runtime_error("unexpected TPM public key/template attributes");
}
static void emitPublic(const TPM2B_PUBLIC& pub) {
    validate(pub);
    std::cout << "\"x\":\"" << hex(pub.publicArea.unique.ecc.x.buffer, 32)
        << "\",\"y\":\"" << hex(pub.publicArea.unique.ecc.y.buffer, 32) << "\"";
}
int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("usage: tpm-key create|public|sign|probe");
        std::string op = argv[1];
        if (op != "create" && op != "public" && op != "sign" && op != "probe")
            throw std::runtime_error("unknown operation");
        TPM t; t.connect();
        if (op == "probe") { std::cout << "{\"connected\":true}\n"; return 0; }
        t.makePrimary();
        if (op == "create") {
            TPM2B_SENSITIVE_CREATE sensitive{}; TPM2B_PUBLIC pub{};
            pub.publicArea.type = TPM2_ALG_ECC; pub.publicArea.nameAlg = TPM2_ALG_SHA256;
            pub.publicArea.objectAttributes = attributes;
            auto& p = pub.publicArea.parameters.eccDetail;
            p.symmetric.algorithm = TPM2_ALG_NULL; p.scheme.scheme = TPM2_ALG_ECDSA;
            p.scheme.details.ecdsa.hashAlg = TPM2_ALG_SHA256;
            p.curveID = TPM2_ECC_NIST_P256; p.kdf.scheme = TPM2_ALG_NULL;
            TPM2B_DATA outside{}; TPML_PCR_SELECTION pcr{};
            Owned<TPM2B_PRIVATE> priv; Owned<TPM2B_PUBLIC> result;
            Owned<TPM2B_CREATION_DATA> creation; Owned<TPM2B_DIGEST> hash;
            Owned<TPMT_TK_CREATION> ticket;
            check(Esys_Create(t.esys, t.primary, ESYS_TR_PASSWORD, ESYS_TR_NONE,
                ESYS_TR_NONE, &sensitive, &pub, &outside, &pcr, &priv.p,
                &result.p, &creation.p, &hash.p, &ticket.p), "Create");
            validate(*result.p);
            uint8_t publicBytes[4096], privateBytes[4096]; size_t u = 0, r = 0;
            check(Tss2_MU_TPM2B_PUBLIC_Marshal(result.p, publicBytes, sizeof(publicBytes), &u), "marshal public");
            check(Tss2_MU_TPM2B_PRIVATE_Marshal(priv.p, privateBytes, sizeof(privateBytes), &r), "marshal private");
            std::cout << "{"; emitPublic(*result.p);
            std::cout << ",\"publicBlob\":\"" << hex(publicBytes, u)
                << "\",\"privateBlob\":\"" << hex(privateBytes, r) << "\"}\n";
        } else {
            auto u = readHex(), r = readHex(); size_t off = 0;
            TPM2B_PUBLIC pub{}; TPM2B_PRIVATE priv{};
            check(Tss2_MU_TPM2B_PUBLIC_Unmarshal(u.data(), u.size(), &off, &pub), "unmarshal public");
            if (off != u.size()) throw std::runtime_error("trailing public bytes");
            off = 0;
            check(Tss2_MU_TPM2B_PRIVATE_Unmarshal(r.data(), r.size(), &off, &priv), "unmarshal private");
            if (off != r.size()) throw std::runtime_error("trailing private bytes");
            validate(pub);
            check(Esys_Load(t.esys, t.primary, ESYS_TR_PASSWORD, ESYS_TR_NONE,
                ESYS_TR_NONE, &priv, &pub, &t.child), "Load");
            if (op == "public") { std::cout << "{"; emitPublic(pub); std::cout << "}\n"; }
            else {
                auto d = readHex(); if (d.size() != 32) throw std::runtime_error("digest must be SHA-256");
                TPM2B_DIGEST digest{}; digest.size = 32; memcpy(digest.buffer, d.data(), 32);
                TPMT_SIG_SCHEME scheme{}; scheme.scheme = TPM2_ALG_ECDSA;
                scheme.details.ecdsa.hashAlg = TPM2_ALG_SHA256;
                TPMT_TK_HASHCHECK validation{}; validation.tag = TPM2_ST_HASHCHECK;
                validation.hierarchy = TPM2_RH_NULL;
                Owned<TPMT_SIGNATURE> signature;
                check(Esys_Sign(t.esys, t.child, ESYS_TR_PASSWORD, ESYS_TR_NONE,
                    ESYS_TR_NONE, &digest, &scheme, &validation, &signature.p), "Sign");
                auto& sig = signature.p->signature.ecdsa;
                if (signature.p->sigAlg != TPM2_ALG_ECDSA || sig.hash != TPM2_ALG_SHA256)
                    throw std::runtime_error("unexpected signature algorithm");
                std::cout << "{\"r\":\"" << hex(sig.signatureR.buffer, sig.signatureR.size)
                    << "\",\"s\":\"" << hex(sig.signatureS.buffer, sig.signatureS.size) << "\"}\n";
            }
        }
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
