# Phase 5 — Automated Trend Research Engine

## Overview

This phase adds an integrated research layer to the front of the discovery pipeline. Instead of manually entering theses, the app can scan for emerging technology convergence trends across defined research domains, synthesize findings into candidate theses, and feed them directly into the existing discovery engine.

The workflow becomes: **Research → Analyze → Discover → Score → Watchlist**

---

## How It Works

### New "Research" Tab

A new primary tab sits before Discover in the navigation. It provides two modes:

**1. Guided Scan** — The user selects 2-3 research domains from a predefined list and hits "Scan for Convergence." The system uses Gemini 3.5 Flash with grounded Google Search to scan recent sources (30-day lookback, 180-day exclusion filter) and returns a structured report of emerging cross-domain trends.

**2. Open Prompt** — The user enters a free-form research prompt (e.g., "What's converging between solid-state batteries and autonomous vehicles?") and gets the same structured output.

### Output: Trend Research Report

Each scan produces a report containing:

- **Executive Summary** — 2-3 paragraph synthesis of what's emerging across the selected domains
- **Candidate Theses** — 3-5 ranked convergence theses, each with:
  - Thesis statement (ready to paste into Discovery)
  - Convergence type: demand/supply, parallel growth, regulatory catalyst, technology enablement
  - Recency signal: when this started trending (must be within 30 days)
  - Source citations with dates and links
  - Estimated maturity: Nascent / Pre-emergence / Early emergence
  - Confidence level: High / Medium / Speculative
- **Companies Already Mentioned** — Any publicly traded companies referenced in the source material, flagged with market cap tier (micro/small/mid/large)
- **Adjacent Signals** — Weak signals that aren't theses yet but worth monitoring

Each candidate thesis gets a **"Load into Discovery"** button that populates the trend input fields in the Discover tab and optionally auto-runs analysis.

---

## Research Domains

### Core Domains (from your original prompt)

1. **Biotechnology & Life Sciences** — Gene therapy (CRISPR, base editing), synthetic biology, biomanufacturing, drug delivery systems, personalized medicine, longevity research, computational biology
2. **Energy & Power Systems** — SMRs, fusion, grid-scale storage, next-gen solar (perovskite), hydrogen economy, geothermal, energy harvesting, power electronics
3. **Materials Science & Advanced Manufacturing** — Metamaterials, advanced composites, 3D/4D printing, nanomaterials, self-healing materials, advanced ceramics, biodegradable materials
4. **Quantum Computing & Quantum Technologies** — Quantum processors, quantum networking, quantum sensing, post-quantum cryptography, quantum simulation for drug/materials discovery
5. **Artificial Intelligence & Machine Learning** — Foundation models, agentic AI, edge AI, neuromorphic computing, AI safety/alignment, AI for science, embodied AI
6. **Semiconductors & Compute Infrastructure** — Advanced packaging (chiplets), photonic computing, custom silicon (ASICs), RISC-V, EUV lithography, in-memory computing

### Expanded Domains (gaps in your current list)

7. **Robotics & Physical AI** — Humanoid robotics, autonomous mobile robots (warehouse, surgical, agricultural), drone swarms, soft robotics, robotic process automation converging with physical systems. This is one of the hottest convergence areas right now — AI moving from digital to physical.

8. **Space & Satellite Technology** — Satellite mega-constellations, space-based manufacturing, in-orbit servicing, Earth observation data, space debris management, launch cost reduction. The commercialization of LEO is creating infrastructure plays analogous to early internet backbone companies.

9. **Defense & National Security Technology** — Autonomous weapons systems, electronic warfare, hypersonics, directed energy weapons, cyber-physical defense, dual-use technology crossover. Defense spending is a massive demand signal that pulls from AI, materials, quantum, and space simultaneously.

10. **Climate & Sustainability Technology** — Carbon capture and utilization, industrial decarbonization, circular economy platforms, methane detection/reduction, sustainable aviation fuel, ocean/marine tech, climate data analytics. Regulatory tailwinds (carbon pricing, ESG mandates) create predictable demand curves.

11. **Edge Computing & Next-Gen Connectivity** — 5G/6G infrastructure, satellite-terrestrial network convergence, edge AI inference, private networks, ultra-low-latency applications. The compute-at-the-edge trend intersects with robotics, autonomous vehicles, and IoT in ways that create infrastructure demand.

12. **Digital Health & Medtech** — Wearable diagnostics, remote patient monitoring, AI-assisted radiology/pathology, surgical robotics, digital therapeutics, health data interoperability. Distinct from biotech — this is the hardware/software/data layer of healthcare transformation.

13. **Fintech & Digital Assets** — Tokenization of real-world assets, decentralized finance infrastructure, embedded finance, programmable money, stablecoin infrastructure, regulatory technology. Not crypto speculation — the infrastructure layer being built for institutional adoption.

14. **Water & Agriculture Technology** — Precision agriculture, vertical farming, water purification/desalination, soil health monitoring, agricultural biologicals, food supply chain optimization. Overlooked but massive — water scarcity and food security are converging with sensor tech, AI, and biotech.

### Why These Domains Matter for Convergence

The magic of your approach is finding where Domain A's demand signal meets Domain B's supply capability before the market prices it in. The expanded list creates more intersection opportunities:

- Robotics + Materials Science = next-gen manufacturing
- Space + Edge Computing = satellite-edge hybrid networks
- Climate Tech + Energy = carbon-negative power systems
- Digital Health + AI + Biotech = AI-driven drug discovery pipeline
- Defense + Quantum + Cybersecurity = post-quantum national security
- Agriculture + Biotech + Climate = climate-resilient food systems
- Fintech + Quantum = quantum-resistant financial infrastructure

The researcher should be scanning for these cross-domain intersections, not just trends within a single domain.

---

## Research Prompt Engineering

The Gemini call for the research scan should use grounded search (Google Search tool) and be structured as follows:

### System Prompt for Research Agent

```
Role: You are a research analyst specializing in identifying emerging technology convergence trends for investment purposes. You focus on finding where demand signals in one industry intersect with supply capabilities in another, creating investment opportunities before the broader market recognizes them.

Research Domains: [dynamically populated based on user selection]

Constraints:
- Only surface trends that have emerged or significantly accelerated in the past 30 days
- Exclude any trend that has been widely covered for more than 180 days — if it's already consensus, it's priced in
- Prioritize cross-domain convergence over single-domain trends
- For any companies mentioned, flag their market cap tier (micro < $300M, small $300M-$2B, mid $2B-$10B, large > $10B)
- Prioritize companies that have NOT rallied significantly (>30%) in the past 6 months
- Source from: research papers, news aggregators, X/Twitter, Reddit communities, YouTube technical content, patent filings, government funding announcements, conference proceedings

Output Format: Return a structured JSON object matching the TrendResearchReport schema.
```

### Structured Output Schema

```typescript
interface TrendResearchReport {
  executiveSummary: string;
  scanDate: string;
  domainsScanned: string[];
  candidateTheses: CandidateThesis[];
  companiesMentioned: MentionedCompany[];
  adjacentSignals: string[];
}

interface CandidateThesis {
  thesisStatement: string;           // Ready to paste into Discovery
  convergenceType: 'demand_supply' | 'parallel_growth' | 'regulatory_catalyst' | 'technology_enablement';
  domainsInvolved: string[];          // Which research domains intersect
  recencySignal: string;             // When this started trending
  maturity: 'Nascent' | 'Pre-emergence' | 'Early emergence';
  confidence: 'High' | 'Medium' | 'Speculative';
  rationale: string;                 // Why this convergence matters
  sources: Source[];
}

interface Source {
  title: string;
  url: string;
  date: string;
  sourceType: 'research_paper' | 'news' | 'social' | 'video' | 'patent' | 'government';
}

interface MentionedCompany {
  name: string;
  ticker: string;
  marketCapTier: 'micro' | 'small' | 'mid' | 'large';
  context: string;                   // Why this company was mentioned
  recentRally: boolean;              // Has it rallied >30% in 6 months
}
```

---

## API Route

`POST /api/research`

**Request:**
```json
{
  "domains": ["energy", "ai", "materials"],
  "mode": "guided",
  "customPrompt": null
}
```

or

```json
{
  "domains": [],
  "mode": "open",
  "customPrompt": "What emerging trends connect solid-state batteries with autonomous vehicle adoption?"
}
```

**Response:** `TrendResearchReport` JSON object

### Caching

Research results cached for 7 days per domain combination hash. Manual "Refresh Research" button available to bust cache.

---

## UI Components

### ResearchPanel.tsx

- Domain selector: multi-select grid of the 14 research domains with icons and short descriptions
- OR free-form prompt input field
- "Scan for Convergence" button
- Loading state with progress indicators

### ResearchReport.tsx

- Executive summary section
- Candidate theses as expandable cards, each with:
  - Thesis statement (prominent)
  - Convergence type badge
  - Maturity and confidence indicators
  - Source list with links and dates
  - **"Load into Discovery →"** action button
- Companies mentioned section with market cap tier badges
- Adjacent signals as a compact list

### Navigation Update

Tab order becomes: **Research → Discover → History → Watchlist → Portfolios**

---

## Database Addition

```
research_scans
  id            UUID
  created_at    DateTime
  domains       String[]
  custom_prompt String?
  report        JSON           // Full TrendResearchReport
  cached_until  DateTime

research_loaded_theses
  id            UUID
  scan_id       UUID → research_scans
  thesis        String
  loaded_at     DateTime
  search_id     UUID? → searches  // Links to the discovery search that used this thesis
```

---

## Build Plan

1. Add research domain configuration (domain list with metadata)
2. Build `/api/research` route with Gemini grounded search integration
3. Build ResearchPanel component with domain selector and prompt input
4. Build ResearchReport component with thesis cards and "Load into Discovery" flow
5. Wire "Load into Discovery" to populate trend fields in Discover tab
6. Add research_scans table to Prisma schema
7. Add Research tab to navigation
8. Cache research results (7-day TTL)
9. Test end-to-end: Research → Load Thesis → Analyze → Discover → Score

---

## Important Notes

- **Gemini grounded search is key.** This feature requires the model to have access to real-time web search results. Use `google_search` as a tool in the Gemini API call. Without grounding, the model will hallucinate trends based on training data, which defeats the purpose of the 30-day recency filter.

- **Source quality matters.** The researcher prompt explicitly deprioritizes social media noise and prioritizes research papers, patent filings, government funding announcements, and credible news sources. Social signals (X, Reddit) are supplementary — they indicate momentum, not validity.

- **The 180-day exclusion filter is critical.** If everyone already knows about a trend, it's priced in. The whole point is finding convergence before it becomes consensus. The researcher should actively filter out trends that have extensive coverage predating the 30-day window.

- **This doesn't replace your judgment.** The researcher surfaces candidates. You evaluate whether the convergence thesis is real, whether the timing is right, and whether the market has already noticed. The tool accelerates your pattern recognition — it doesn't replace it.
