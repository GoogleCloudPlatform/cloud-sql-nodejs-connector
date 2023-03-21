# Test Notes

## Creating the Server's Certificate and Keys

The following is a quick how-to on regenerating the certificates used in tests.

**Note:** the current certs were generated using openssl@3.0.7 (installed
via homebrew) running on macos 12.6.3.

1. Generate a private key for the CA:

```
$ openssl genrsa 2048 > ca-key.pem
```

2. Generate the X509 certificate for the CA:

```
$ openssl req -new -x509 -nodes -days 365000 -key ca-key.pem -out ca-cert.pem
```

3. Generate the private key and certificate request:

```
$ openssl req -sha256 -newkey rsa:2048 -nodes -days 365000 -keyout server-key.pem -out server-req.pem
```

4. Generate the X509 certificate for the server:

```
$ openssl x509 -sha256 -days 365000 -req -set_serial 01 -in server-req.pem -out server-cert.pem -CA ca-cert.pem -CAkey ca-key.pem
```

5. Generate the private key and certificate request:

```
$ openssl req -sha256 -newkey rsa:2048 -nodes -days 365000 -keyout client-key.pem -out client-req.pem
```

6. Generate the X509 certificate for the client:

```
$ openssl x509 -sha256 -req -days 365000 -set_serial 01 -in client-req.pem -out client-cert.pem -CA ca-cert.pem -CAkey ca-key.pem
```

7. Update the `test/fixtures/certs.ts` file:

```
$ cat ca-cert.pem | pbcopy
```

Open `test/fixture/certs.ts` in your code editor of choice, replace the value
of `CA_CERT` pasting from your clipboard.

Repeat this for the remainder of the cert/key values:

- Update the `SERVER_CERT` value with contents from `server-cert.pem`
- Update the `SERVER_KEY` value with contents from `server-key.pem`
- Update the `CLIENT_CERT` value with contents from `client-cert.pem`
- Update the `CLIENT_KEY` value with contents from `client-key.pem`
