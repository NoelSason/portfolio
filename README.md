# Noel Sason's portfolio

A one-page portfolio with a hidden gene in it, hosted on AWS Amplify Hosting.

- Live site: https://main.d149c0bsd6u3f4.amplifyapp.com
- Built for the AWS Student Builder Challenge, October to November 2026.

The page has About me, Skills, Projects, and Contact sections. Its creative feature, **Translate the gene**, starts from the DNA sequencing trace in the hero. Visitors translate the gene with an *E. coli* ribosome, which stops at `MEETN` because UAG is a stop codon. Then they switch to *Methanosarcina barkeri*, which reads UAG as pyrrolysine (`O`), and the protein spells `MEETNOELSASON`. Visitors can also mutate any base, write their own name in protein, and see how many people have read the message.

## Run it locally

The site is plain HTML, CSS, and JavaScript modules with no build step and no dependencies.

```sh
npm start   # serves site/ at http://localhost:4173
npm test    # runs the genetics unit tests with node:test
```

## Project layout

| Path | What it holds |
|---|---|
| `site/index.html` | The page and the translator dialog |
| `site/css/styles.css` | Design tokens, layout, and light and dark themes |
| `site/js/genetics.js` | Codon table, translation, mutation classes, and name encoding. No DOM code, so Node tests it. |
| `site/js/translator.js` | The translator dialog: ribosome animation, base editing, and the name tool |
| `site/js/main.js` | Draws the sequencing trace and opens the dialog (also from `#gene` links) |
| `site/js/counter.js` | Calls the reader counter. Any failure hides the count line. |
| `tests/genetics.test.mjs` | Unit tests for the genetics logic |
| `infra/counter.yaml` | CloudFormation template for the reader counter |
| `customHttp.yml` | Response headers, including the Content Security Policy |
| `amplify.yml` | Build settings if the Amplify app is ever connected to this repo |
| `scripts/deploy.sh` | Manual deploy to Amplify Hosting |

## AWS architecture

![Architecture diagram](docs/screenshots/architecture.png)

| Service | Role |
|---|---|
| AWS Amplify Hosting | Serves `site/` over HTTPS through Amplify's CloudFront distribution. App `d149c0bsd6u3f4`, branch `main`, manual deployments. |
| AWS Lambda | `POST` adds one reader and `GET` returns the count. Node.js 22, exposed through a function URL with CORS limited to the site's origin and `localhost:4173`. |
| Amazon DynamoDB | One on-demand table with one item. The function uses an atomic `ADD`, so concurrent readers can't overwrite each other. |
| AWS CloudFormation | Stack `portfolio-gene-counter` in `us-east-1` creates the table, role, function, function URL, permissions, and log group from `infra/counter.yaml`. |
| AWS IAM | The function's role can only call `GetItem` and `UpdateItem` on that one table. |
| Amazon CloudWatch Logs | Keeps the function's logs for 30 days. |

The counter is public on purpose and has no authentication, so anyone can inflate it with repeated `POST` requests. Each browser counts itself once, using `localStorage`. The count is a fun number, not a metric.

### Response headers

`customHttp.yml` holds the headers: HSTS, `nosniff`, a referrer policy, and a Content Security Policy. The policy allows scripts only from the site and network calls only to the site and Lambda function URLs in `us-east-1`. It also sets `frame-ancestors 'none'`. The live headers come from the Amplify app's settings, which hold the same YAML. To change the headers, edit the file, then apply it to the app:

```sh
aws amplify update-app --app-id d149c0bsd6u3f4 --region us-east-1 \
  --custom-headers "$(cat customHttp.yml)"
```

## Deploy

To deploy the site, sign in with the AWS CLI (`aws login`) and run the deploy script. It runs the tests, zips `site/`, uploads the zip to Amplify, and waits for the job to finish.

```sh
scripts/deploy.sh
```

To update the counter stack after you edit `infra/counter.yaml`, run:

```sh
aws cloudformation deploy --region us-east-1 \
  --stack-name portfolio-gene-counter \
  --template-file infra/counter.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides AllowedOrigin=https://main.d149c0bsd6u3f4.amplifyapp.com
```

The stack outputs `CounterUrl`, the value of `COUNTER_URL` in `site/js/counter.js`.

## The biology

- The gene is 14 codons long: `ATG GAG GAA ACC AAC TAG GAG CTG TCC GCC AGC TAG AAT TAA`.
- The standard genetic code (NCBI table 1) treats UAG as a stop codon. *Methanosarcina* species read UAG as pyrrolysine, the 22nd amino acid, with one-letter code `O`.
- In the name tool, `U` is selenocysteine. Human cells read UGA as selenocysteine only when the RNA carries a SECIS element, and the human genome has 25 selenoprotein genes. `B`, `J`, `X`, and `Z` are ambiguity codes, not amino acids.
