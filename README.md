\documentclass[a4paper,10pt]{article}
\usepackage{enumitem}
\usepackage{geometry}
\usepackage{hyperref}
\usepackage{titlesec}
\usepackage{setspace}
\usepackage{xcolor}

\geometry{top=0.22in, bottom=0.22in, left=0.5in, right=0.5in}

\hypersetup{
    colorlinks=true,
    linkcolor=blue!60!black,
    urlcolor=blue!60!black,
    citecolor=blue!60!black
}

\setlength{\parskip}{0.2em}
\setlength{\parindent}{0pt}
\linespread{0.82}
\titleformat{\section}{\large\bfseries}{}{0pt}{}
\titlespacing*{\section}{0pt}{0.8em}{0.4em}

\begin{document}

\begin{center}
    {\LARGE Ziwei Guo} \\
    Nashville, TN | (223)-533-1053 | \href{mailto:gzw19914760905@outlook.com}{gzw19914760905@outlook.com} | \href{https://www.linkedin.com/in/ziwei-guo-009690226/}{LinkedIn} | \href{https://github.com/kakarottoooo}{GitHub} | \href{https://www.ziweiguo.com}{ziweiguo.com}
\end{center}

\vspace{-1.8em}
\section*{Summary}
\vspace{-1em}
\rule{\textwidth}{0.4pt}
\noindent
Full-stack engineer and solo founder building production AI agents. Shipped a live agent platform (\href{https://onegent.one/}{onegent.one}) that automates real-world booking workflows end-to-end. Tesla intern delivering an LLM tool-calling diagnostics agent across three factories. Strongest in Python/TypeScript agent orchestration, data-intensive backend systems, and shipping reliable automation into messy real-world domains.

\vspace{-0.8em}
\section*{Education}
\vspace{-1em}
\rule{\textwidth}{0.4pt}
\textbf{Vanderbilt University}, Nashville, Tennessee \\
\textit{MS in Computer Science} \hfill Expected Graduation: May 2026 \\
GPA: 3.89/4.00 \\[-1em]

\noindent
\textbf{Dickinson College}, Carlisle, Pennsylvania \\
\textit{BS in Mathematics \& Data Analytics with Music Minor} \hfill Aug 2020 -- May 2024 \\
GPA: 3.38/4.00 \\

\vspace{-1.6em}
\section*{Technical Skills}
\vspace{-1.3em}
\rule{\textwidth}{0.4pt}
\noindent
\textbf{Production Agent Systems:} ReAct, Function Calling, Tool/Agent Orchestration, MCP, Multi-Provider Fallback, Long-Running Workers, Audit-Trail Tracing, LLM Fine-tuning (SFT), RAG, Stagehand, Playwright \\
\textbf{Languages:} Python, TypeScript/JavaScript, Go, SQL, C/C++ \\
\textbf{Data-Intensive Backend:} PostgreSQL, Neon, Redis, Kafka, REST APIs, WebSockets, SSE, ETL Pipelines, NetworkX Knowledge Graphs, Vector Retrieval (BGE, FAISS) \\
\textbf{Infra \& DevOps:} Kubernetes, Docker, Vault, AWS, Railway, Vercel, Prometheus, Grafana, PromQL, Linux/Unix, CI/CD \\
\textbf{Frontend:} React.js, Next.js (App Router), Tailwind CSS, D3.js \\

\vspace{-1.2em}
\section*{Projects}
\vspace{-1em}
\rule{\textwidth}{0.4pt}

\noindent
\textbf{Onegent --- Autonomous Decision Agent Platform} \hfill 2025--2026\\
\textit{Live: \href{https://onegent.one/}{onegent.one} \, $\cdot$ \, Source: \href{https://github.com/kakarottoooo}{github.com/kakarottoooo} \, $\cdot$ \, 1{,}000+ commits, solo founder, 12+ months}\\[-0.5em]
\begin{itemize}[leftmargin=*, topsep=0pt, itemsep=0.18em]
    \item Designed and shipped a \textbf{live data-intensive agent platform} that closes the full loop --- search, compare, filter, recommend, execute, observe, learn --- across eight domains (restaurants, hotels, flights, credit-card portfolios, electronics, event tickets, gifts, fitness); turns natural-language input into structured executable plans grounded in real-time inventory from Google Places, SerpAPI, Tavily, and Ticketmaster.
    \item Built \textbf{Autopilot}, an autonomous execution layer that drives real booking platforms (Booking.com, Expedia, Hotels.com, OpenTable, Resy, Yelp) to completion: hybrid \textbf{AI-first + deterministic-fallback browser automation} on Stagehand + Playwright with model-based page perception, selector self-healing, autonomous recovery (time-slot fallback, venue substitution, retry with backoff), and a payment-safety boundary that hands control back at the CVV step.
    \item Engineered the orchestration backbone: long-running \textbf{Railway workers}, \textbf{Postgres-backed execution state} for plans / steps / retries / audit traces, multi-provider waterfall routing keyed on per-provider success-rate signals, real-time \textbf{SSE screenshot streaming} (\textasciitilde6 fps) of the live browser to the user, and Web Push notifications on completion.
    \item Built a \textbf{three-tier continuous-learning loop} (immediate feedback / 24-hour post-action / session-level preference extraction) that compresses raw user signals into a small persisted preference vector synced across devices, avoiding context-window bloat over time.
    \item Exposed as both a consumer PWA and a \textbf{REST API + MCP server} for external AI agents to trigger real-world execution; designed Clerk-based auth, API-key authentication, developer onboarding flow, and the full Next.js 14 / TypeScript / Tailwind frontend.
\end{itemize}

\noindent
\textbf{GovInsight --- Investigative Research Agent with Knowledge Graph} \hfill 2025--2026\\[-0.5em]
\begin{itemize}[leftmargin=*, topsep=0pt, itemsep=0.15em]
    \item Built a self-hosted \textbf{ReAct} agent with autonomous tool dispatch (retrieval, graph traversal, web search), context compression on overflow, and failure recovery; engineered a production-grade \textbf{RAG pipeline} with \textbf{BGE-large-zh} dense retrieval, BGE-reranker-base reranking, and \textbf{NetworkX-based knowledge graph} expansion over \textbf{3{,}330 document chunks}, generating \textbf{3{,}519 entities} and \textbf{4{,}290 relationships} via hybrid rule-based NER plus LLM reconciliation.
    \item Curated a \textbf{57-sample SFT dataset} (\textbf{1.9M+ training tokens}) for evidence-based reasoning and fine-tuned \textbf{GPT-4o-mini}; benchmarked five retrieval configurations (Recall@10 / NDCG@10 / MRR@10) and shipped the best (HyDE+Hybrid, MRR 0.341) behind a React + Flask + SSE interface with D3.js relationship graph exploration. Achieved 88\% TTFT reduction via prefix caching and 13x retrieval speedup via FAISS HNSW.
\end{itemize}

\vspace{-0.6em}
\section*{Intern Experience}
\vspace{-1em}
\rule{\textwidth}{0.4pt}

\noindent
\textbf{Tesla, Inc. --- Factory Software (FSS)}, Fremont, CA \hfill May 2025 -- Aug 2025 \\
\textit{Software Engineer Intern}\\[-0.5em]
\begin{itemize}[leftmargin=*, topsep=0pt, itemsep=0.18em]
    \item Built \textbf{FSS-Agent}, a production \textbf{LLM tool-calling diagnostics agent} deployed across Fremont, Reno, and Buffalo: translated natural-language operational queries from factory operators into structured \textbf{Prometheus/Grafana KPI health checks} via TAFFY-compliant WebSocket/REST APIs; added structured diagnostics, operator-facing summaries, and audit-style logs, reducing incident triage time by \textbf{30\%+} and saving \textbf{10+ engineer-hours/week} across three factory sites.
    \item Migrated KPI configuration from static YAML to \textbf{Grafana API-driven auto-discovery}: dynamically loaded \textbf{PromQL queries}, thresholds, and dashboard links from \textbf{5 production dashboards} at runtime, enabling per-factory threshold customization without code changes; added structured Zap logging and an unhealthy-KPI summary layer for rapid triage.
    \item Engineered automated \textbf{Kafka TLS certificate rotation} (cert-manager + Vault) and a \textbf{Nuclio serverless service-account rotation system} spanning multi-cluster / multi-namespace environments with safety delay, deduplication, retry logic, and HTML alerting --- standardizing zero-touch credential renewal for \textbf{17+ production services}.
\end{itemize}

\vspace{-0.6em}
\section*{Awards}
\vspace{-1em}
\rule{\textwidth}{0.4pt}
\noindent
\textbf{Kaggle Competitions:} Silver Medal (OTTO Recommender System), Silver Medal (G2Net Gravitational Waves), Bronze Medal (RSNA Cancer Detection)

\end{document}
