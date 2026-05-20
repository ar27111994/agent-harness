# Demand Detection Coverage Matrix

This matrix documents the project types that the demand-profile detector has audited support for, the evidence that should drive each detection path, and the validation fixtures that should protect the behavior. It is intentionally evidence-first: add entries here when support is backed by package/config/file-structure signals and tests, not by broad README keyword guesses.

## Detection evidence rules

Use this priority order when auditing or expanding coverage:

1. **Strong evidence**: dependency manifests, lockfiles, framework config files, host/deploy config, build-system config, strongly typed project files.
2. **Medium evidence**: directory conventions, generated project files, high-signal artifact extensions.
3. **Weak evidence**: README/docs text, marketing copy, generic examples.

Do not add broad text markers for a vertical unless a false-positive fixture proves the term is safe.

## Audited project-type matrix

| Area                             | Current support                                                                                                                                                 | Strong evidence examples                                                                                                           | Fixture / quality coverage                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Frontend apps                    | React, Next.js, Vue/Nuxt, Angular, Svelte, Astro, Remix, Gatsby, Solid, Qwik, Storybook, GraphQL, Electron/Tauri/Capacitor hints                                | `package.json`, framework dependencies, config/package names                                                                       | `technology-signatures.test.ts`, recommendation fixtures                           |
| Backend APIs                     | Node, Python, Java, .NET, Go, Rust, Ruby, PHP, Elixir, Erlang, Julia signals                                                                                    | package manifests, ecosystem-specific dependencies, backend framework packages                                                     | `technology-signatures.test.ts`, recommendation fixtures                           |
| Monorepos/build systems          | Nx, Turborepo, pnpm/yarn/npm workspaces, Rush, Lage, Bazel                                                                                                      | `nx.json`, `turbo.json`, `pnpm-workspace.yaml`, `rush.json`, Bazel workspace/module files                                          | `detection-fixtures.ts`, `technology-signatures.test.ts`                           |
| Serverless/edge/deploy platforms | Cloudflare Workers/Pages, Vercel, Netlify, Lambda/SAM/SST/Serverless, Azure Functions, Google Functions/Cloud Run, Firebase Functions, Deno Deploy              | `wrangler.toml`, `vercel.json`, `netlify.toml`, `serverless.yml`, `sst.config.*`, `firebase.json`, function framework dependencies | `detection-fixtures.ts`, `technology-signatures.test.ts`                           |
| Mobile/cross-platform            | Flutter, Firebase mobile, React Native, Expo, Ionic, Capacitor, Android, iOS, SwiftUI, Kotlin Multiplatform, MAUI/Xamarin                                       | `pubspec.yaml`, `AndroidManifest.xml`, `Podfile`, `Info.plist`, React Native/Expo/Capacitor packages                               | `detection-fixtures.ts`, `technology-signatures.test.ts`, mobile tests             |
| AI/ML/agent apps                 | OpenAI/Anthropic/LangChain/LlamaIndex, Vercel AI SDK, Genkit, Mastra, LangGraph, CrewAI, AutoGen, Semantic Kernel, Haystack, DSPy, RAG/vector/model-serving     | AI framework dependencies, model artifacts, vector DB dependencies, RAG/vector paths                                               | `technology-signatures.test.ts`, `detection-fixtures.ts`                           |
| Commerce/CMS/content             | Shopify, Magento/Adobe Commerce, WooCommerce, WordPress, Drupal, Joomla, Strapi, Payload CMS, Directus, Sanity, Contentful                                      | commerce/CMS packages and config files                                                                                             | `detection-fixtures.ts`, `technology-signatures.test.ts`                           |
| Data/workflow orchestration      | DuckDB, pandas/polars, dbt, Airflow, Dagster, Prefect, Airbyte, Meltano, Temporal, Spark/Flink/Kafka-heavy pipelines                                            | data/package dependencies, `dbt_project.yml`, `airflow.cfg`, orchestration packages                                                | `detection-fixtures.ts`, `technology-signatures.test.ts`                           |
| Desktop apps                     | Electron, Tauri, Wails, Qt, Avalonia, MAUI desktop                                                                                                              | desktop framework packages/configs                                                                                                 | `technology-signatures.test.ts`                                                    |
| Infrastructure/platform/security | Docker, Terraform/OpenTofu-adjacent config, Kubernetes, Helm, Kustomize, Argo-style layout, Pulumi, Ansible, SAST/secret scanning/policy-as-code/security rules | Docker/Terraform/Kubernetes/Helm/Security config files                                                                             | `detection-fixtures.ts`, `technology-signatures.test.ts`, `quality:policy`         |
| Networking/NetOps                | DNS, VPN, WireGuard, routing/firewall/proxy config, network automation packages                                                                                 | known config names and network automation packages                                                                                 | `detection-fixtures.ts`, `technology-signatures.test.ts`                           |
| Embedded/robotics/hardware/CAD   | PlatformIO, Arduino, ESP-IDF, ROS/ROS2, Gazebo/Webots/MoveIt, CAD/slicer/fabrication artifacts                                                                  | project/config/artifact files and dependencies                                                                                     | `detection-fixtures.ts`, `technology-signatures.test.ts`                           |
| Finance/BI/marketing/content     | Trading/backtesting, Power BI/Tableau/Looker, technical SEO, marketing/campaign/content work                                                                    | file extensions, package dependencies, config files                                                                                | `detection-fixtures.ts`, `technology-signatures.test.ts`                           |
| Games/creative/media/design      | Unity, Unreal, Godot, RenPy, design systems, Penpot MRDS/design-source workflows, media/audio/video/VFX assets                                                  | project files, artifact extensions, package dependencies, Penpot MRDS files, design-token files                                    | `detection-fixtures.ts`, `technology-signatures.test.ts`, `demand-profile.test.ts` |

## Gap-audit workflow

1. Add a representative fixture that demonstrates the current false negative, false positive, or weak evidence.
2. Prefer `technology-signatures.ts` for package/config/data-driven recognition.
3. Use `detector-signatures.ts` when file names, paths, or artifact extensions are the strongest evidence.
4. Update `discover/recommendation-policy/base.json` maps when new emitted terms are introduced.
5. Add false-positive coverage when a term is broad (`edge`, `agent`, `platform`, `commerce`, `functions`, etc.).
6. Validate with:

```bash
npm run build
npm run quality:detection
npm run quality:policy
npm run validate:recommendations
```

## Anti-patterns

- Do not infer a specialized stack from one weak README mention.
- Do not add repo-name special cases.
- Do not add broad vertical keywords without a false-positive fixture.
- Do not fix recommendation quality by widening policy when `demand-profile.json` is wrong.
