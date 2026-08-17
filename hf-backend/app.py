# pyright: reportMissingImports=false
# === PATCH: Fix HfFolder removal in newer huggingface_hub versions ===
# Must happen BEFORE import gradio, as gradio.oauth imports HfFolder at module level
import huggingface_hub as _hf_hub  # type: ignore
if not hasattr(_hf_hub, 'HfFolder'):
    class _HfFolder:
        @classmethod
        def get_token(cls): return None
        @classmethod
        def save_token(cls, token): pass
        @classmethod
        def delete_token(cls): pass
    _hf_hub.HfFolder = _HfFolder
    print("🔧 Patched HfFolder for newer huggingface_hub compatibility.")

print("🔧 Patched Jinja2 LRUCache for Gradio 4.44.1 compatibility.")

# === PATCH: Fix Starlette TemplateResponse API mismatch with Gradio 4.44.1 ===
import starlette.templating as _starlette_tpl  # type: ignore

_OrigTemplates = _starlette_tpl.Jinja2Templates

class _PatchedJinja2Templates(_OrigTemplates):
    def TemplateResponse(self, *args, **kwargs):
        if args and isinstance(args[0], str):
            name = args[0]
            context = args[1] if len(args) > 1 else {}
            request = context.get('request') if isinstance(context, dict) else None
            status_code = args[2] if len(args) > 2 else kwargs.pop('status_code', 200)
            headers = kwargs.pop('headers', None)
            media_type = kwargs.pop('media_type', None)
            background = kwargs.pop('background', None)
            if request is not None:
                try:
                    return super().TemplateResponse(
                        request=request, name=name, context=context,
                        status_code=status_code, headers=headers,
                        media_type=media_type, background=background
                    )
                except Exception:
                    pass
        return super().TemplateResponse(*args, **kwargs)

_starlette_tpl.Jinja2Templates = _PatchedJinja2Templates
print("🔧 Patched Starlette TemplateResponse for Gradio 4.44.1 + new Starlette compatibility.")
# === END PATCH ===

import gradio as gr  # type: ignore
import requests
import os
import json
import re
import time
import datetime
import traceback
import concurrent.futures
import spaces  # type: ignore
import urllib.request
import urllib.parse

@spaces.GPU
def _zero_gpu_dummy():
    """Required by HF ZeroGPU supervisor to detect GPU space."""
    return "ok"

print("✅ [NousResearch] Official Hermes Agent Framework loaded successfully!")

OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY", "")
GROQ_KEY_ENV = os.getenv("GROQ_API_KEY", "")
GEMINI_KEY_ENV = os.getenv("GEMINI_API_KEY", "")

MEMORY_FILE = "/tmp/chat_sessions.json"
REASONING_FILE = "/tmp/reasoning_sessions.json"
chat_sessions = {}
reasoning_sessions = {}

# Session Memory Persistence
def load_mem():
    global chat_sessions, reasoning_sessions
    try:
        if os.path.exists(MEMORY_FILE):
            with open(MEMORY_FILE, "r", encoding="utf-8") as f:
                chat_sessions = json.load(f)
            print(f"💾 [Session Memory] Loaded {len(chat_sessions)} user sessions.")
    except Exception as e:
        print(f"⚠️ Memory load note: {e}")

    try:
        if os.path.exists(REASONING_FILE):
            with open(REASONING_FILE, "r", encoding="utf-8") as f:
                reasoning_sessions = json.load(f)
            print(f"⚙️ [Reasoning Config] Loaded {len(reasoning_sessions)} user preferences.")
    except Exception as e:
        print(f"⚠️ Reasoning load note: {e}")

def save_mem():
    try:
        with open(MEMORY_FILE, "w", encoding="utf-8") as f:
            json.dump(chat_sessions, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ Memory save note: {e}")

def save_reasoning_mem():
    try:
        with open(REASONING_FILE, "w", encoding="utf-8") as f:
            json.dump(reasoning_sessions, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ Reasoning save note: {e}")

load_mem()

def get_current_time_str() -> str:
    """Get accurate current Jakarta date and time string for real-time temporal grounding."""
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7)))
    days = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
    months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    day_name = days[now.weekday()]
    month_name = months[now.month - 1]
    return f"{day_name}, {now.day} {month_name} {now.year} ({now.strftime('%H:%M')} WIB)"

def clean_whatsapp_text(text: str) -> str:
    """Format response for clean WhatsApp display: strip markdown link URLs, raw citations, and fix formatting."""
    if not text:
        return ""
    
    # 1. Convert markdown link syntax [Link Text](http://url) -> Link Text (or strip url)
    text = re.sub(r'\[([^\]]+)\]\((https?://[^\s\)]+)\)', r'\1', text)
    
    # 2. Strip raw web citation brackets like [7][6][5][9] or [1]
    text = re.sub(r'\[\d+\]', '', text)
    
    # 3. Convert markdown headers like ### Title or ## Title -> *Title*
    text = re.sub(r'^(#{1,6})\s*(.+)$', r'*\2*', text, flags=re.MULTILINE)
    
    # 4. Convert **bold** to *bold* (WhatsApp bold format)
    text = re.sub(r'\*\*(.*?)\*\*', r'*\1*', text)
    
    # 5. Clean up multiple empty lines (max 2 consecutive newlines)
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    return text.strip()

def format_duration(seconds: float) -> str:
    """Format reasoning duration into human readable string (seconds or minutes)."""
    if seconds >= 60:
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins} minute{'s' if mins > 1 else ''} {secs} second{'s' if secs != 1 else ''}"
    else:
        return f"{seconds:.1f} seconds"

def ddg_search(query: str) -> str:
    try:
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=6) as response:
            html = response.read().decode('utf-8', errors='ignore')
            snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
            clean = [re.sub(r'<[^>]+>', '', s).strip() for s in snippets[:5]]
            if clean:
                return "\n".join(clean)
    except Exception as e:
        print(f"⚠️ DDG search error: {e}")
    return ""

# Helper for calling Groq API directly (FREE, Ultra-Fast Llama 3.3 70B & Qwen 72B & DeepSeek R1)
def call_groq(model_id: str, messages: list, groq_key: str = "", max_tokens: int = 1500, timeout: int = 15) -> str:
    key = groq_key or GROQ_KEY_ENV
    if not key:
        return ""
    try:
        res = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json"
            },
            json={
                "model": model_id,
                "messages": messages,
                "max_tokens": max_tokens
            },
            timeout=timeout
        )
        if res.status_code == 200:
            data = res.json()
            choices = data.get("choices", [])
            if choices and isinstance(choices, list) and len(choices) > 0:
                msg = choices[0].get("message", {})
                content = msg.get("content")
                if content and isinstance(content, str):
                    return content.strip()
        else:
            print(f"⚠️ Groq Model {model_id} HTTP status: {res.status_code}")
    except Exception as e:
        print(f"⚠️ Groq model {model_id} error: {e}")
    return ""

# Helper for calling Google Gemini API directly (FREE 60 req/min, Google Search Grounding Builtin!)
def call_gemini(prompt_text: str, system_instruction: str = "", gemini_key: str = "", enable_search: bool = True, timeout: int = 18) -> str:
    key = gemini_key or GEMINI_KEY_ENV
    if not key:
        return ""
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}"
        payload = {
            "contents": [{"parts": [{"text": prompt_text}]}]
        }
        if system_instruction:
            payload["system_instruction"] = {"parts": [{"text": system_instruction}]}
        if enable_search:
            payload["tools"] = [{"googleSearch": {}}]
            
        res = requests.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=timeout)
        if res.status_code == 200:
            data = res.json()
            candidates = data.get("candidates", [])
            if candidates and len(candidates) > 0:
                parts = candidates[0].get("content", {}).get("parts", [])
                text_parts = [p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p]
                full_text = "\n".join(text_parts).strip()
                if full_text:
                    return full_text
        else:
            print(f"⚠️ Gemini API HTTP status: {res.status_code}")
    except Exception as e:
        print(f"⚠️ Gemini API error: {e}")
    return ""

# Helper for calling OpenRouter models safely
def call_openrouter(model_id: str, messages: list, max_tokens: int = 1200, timeout: int = 16) -> str:
    if not OPENROUTER_KEY:
        return ""
    try:
        res = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/NousResearch/hermes-agent",
                "X-Title": "Hermes Multi-Agent Swarm"
            },
            json={
                "model": model_id,
                "messages": messages,
                "max_tokens": max_tokens
            },
            timeout=timeout
        )
        if res.status_code == 200:
            data = res.json()
            choices = data.get("choices", [])
            if choices and isinstance(choices, list) and len(choices) > 0:
                msg = choices[0].get("message", {})
                content = msg.get("content")
                if content and isinstance(content, str):
                    return content.strip()
        else:
            print(f"⚠️ OpenRouter Model {model_id} HTTP status: {res.status_code}")
    except Exception as e:
        print(f"⚠️ OpenRouter model {model_id} error: {e}")
    return ""

# ==============================================================================
# SUB-AGENT RESEARCH SWARM WORKERS
# ==============================================================================

# Sub-Agent 1: Real-Time Web Search (DuckDuckGo Live Search Grounding + Groq -> Gemini)
def worker_web_search(messages, prompt_clean, gemini_key="", groq_key=""):
    # Primary: DuckDuckGo Live Web Search Grounding + Groq Llama 3.3 70B (Fast & Accurate)
    search_context = ddg_search(prompt_clean)
    if search_context:
        search_messages = [
            {"role": "system", "content": "Gunakan hasil pencarian web terkini berikut untuk memberikan jawaban faktual dan harga terbaru di Indonesia:\n\n" + search_context},
            {"role": "user", "content": prompt_clean}
        ]
        res = call_groq("llama-3.3-70b-versatile", search_messages, groq_key=groq_key)
        if res: return res

    # Secondary: Direct Gemini 2.0 Flash
    res = call_gemini(prompt_clean, system_instruction="Cari berita & informasi faktual terkini hari ini di Indonesia.", gemini_key=gemini_key, enable_search=True)
    if res: return res

    # Tertiary: Groq Direct
    res = call_groq("llama-3.3-70b-versatile", messages, groq_key=groq_key, max_tokens=1000)
    if res: return res
    return ""

# Sub-Agent 2: Gemini Global Knowledge Base
def worker_gemini_knowledge(messages, prompt_clean, gemini_key="", groq_key=""):
    res = call_groq("llama-3.3-70b-versatile", messages, groq_key=groq_key, max_tokens=1000)
    if res: return res

    res = call_gemini(prompt_clean, system_instruction="Fokus pada fakta pengetahuan umum global.", gemini_key=gemini_key, enable_search=False)
    if res: return res

    res = call_groq("gemma2-9b-it", messages, groq_key=groq_key, max_tokens=1000)
    if res: return res
    return ""

# Sub-Agent 3: Qwen 2.5 72B Deep Analytics (via Groq / OpenRouter)
def worker_qwen_analytics(messages, groq_key=""):
    res = call_groq("llama-3.3-70b-versatile", messages, groq_key=groq_key, max_tokens=1000)
    if res: return res

    res = call_groq("qwen-2.5-coder-32b", messages, groq_key=groq_key, max_tokens=1000)
    if res: return res
    return ""

# Sub-Agent 4: Meta Llama 3.3 70B Contextual Reasoning (via Groq / OpenRouter)
def worker_llama_intelligence(messages, groq_key=""):
    res = call_groq("llama-3.3-70b-versatile", messages, groq_key=groq_key, max_tokens=1000)
    if res: return res
    return ""


def hermes_chat(user_jid: str, prompt_text: str, reasoning: bool = None, groq_key: str = "", gemini_key: str = "") -> str:
    overall_start = time.time()
    t_stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    user_jid = user_jid or "anon_user"
    
    # Store or retrieve reasoning preferences
    if reasoning is not None:
        reasoning_sessions[user_jid] = bool(reasoning)
        save_reasoning_mem()
        
    is_reasoning_active = reasoning_sessions.get(user_jid, True)
    
    if not prompt_text or not prompt_text.strip():
        print(f"[{t_stamp}] ⚠️ [User: {user_jid}] Empty prompt received.")
        return "Prompt tidak boleh kosong."
        
    prompt_clean = prompt_text.strip()
    
    # Session History Management (keep last 6 turns)
    if user_jid not in chat_sessions:
        chat_sessions[user_jid] = []
        
    history = chat_sessions[user_jid][-6:]
    
    system_ctx = "Fokus pada informasi, fakta, dan berita real-time terkini hari ini secara akurat."
    messages = [{"role": "system", "content": system_ctx}]
    for m in history:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": prompt_clean})
    
    print(f"\n==================================================")
    print(f"📥 [{t_stamp}] [User JID: {user_jid}] New Prompt ({len(prompt_clean)} chars) | Reasoning Active: {is_reasoning_active}:")
    print(f"   \"{prompt_clean[:120]}...\"" if len(prompt_clean) > 120 else f"   \"{prompt_clean}\"")
    
    # PHASE 1: Concurrent Sub-Agent Swarm Research (4 Workers Parallel)
    print(f"🌐 [Phase 1] Launching Multi-Agent Swarm (4 Parallel Research Workers)...")
    
    rep_web = ""
    rep_gemini = ""
    rep_qwen = ""
    rep_llama = ""
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        f_web = executor.submit(worker_web_search, messages, prompt_clean, gemini_key, groq_key)
        f_gemini = executor.submit(worker_gemini_knowledge, messages, prompt_clean, gemini_key, groq_key)
        f_qwen = executor.submit(worker_qwen_analytics, messages, groq_key)
        f_llama = executor.submit(worker_llama_intelligence, messages, groq_key)
        
        try: rep_web = f_web.result(timeout=16)
        except: pass
        
        try: rep_gemini = f_gemini.result(timeout=16)
        except: pass
        
        try: rep_qwen = f_qwen.result(timeout=16)
        except: pass
        
        try: rep_llama = f_llama.result(timeout=16)
        except: pass

    active_reports_count = sum(1 for r in [rep_web, rep_gemini, rep_qwen, rep_llama] if r)
    print(f"   📊 [Swarm Reports Received: {active_reports_count}/4 Workers]")
    print(f"      1️⃣  🌐 Live Web Search (DDG + Groq): {len(rep_web)} chars")
    print(f"      2️⃣  ✨ Gemini Global Knowledge: {len(rep_gemini)} chars")
    print(f"      3️⃣  ⚡ Qwen 2.5 Analytics: {len(rep_qwen)} chars")
    print(f"      4️⃣  🦙 Meta Llama 3.3 70B Intelligence: {len(rep_llama)} chars")
    
    # PHASE 2: DeepSeek R1 / Groq / Gemini Supreme Judge & Master Synthesizer
    judge_start = time.time()
    print(f"⚖️ [Phase 2] Supreme Judge synthesizing & cross-examining 4 Sub-Agent research reports...")
    
    judge_prompt = f"""You are the Chief AI Researcher & Supreme Judge.
Before providing your final response, you MUST think step-by-step inside <think>...</think> tags to thoroughly analyze, cross-examine, and verify all 4 sub-agent reports.

User Question: {prompt_clean}

Below are the independent research reports submitted by our 4 specialized AI sub-agent workers:

=== SUB-AGENT RESEARCH REPORT 1: REAL-TIME WEB SEARCH (DUCKDUCKGO LIVE SEARCH) ===
{rep_web if rep_web else 'No live web data gathered.'}

=== SUB-AGENT RESEARCH REPORT 2: GEMINI GLOBAL KNOWLEDGE BASE ===
{rep_gemini if rep_gemini else 'No Gemini knowledge data.'}

=== SUB-AGENT RESEARCH REPORT 3: QWEN 2.5 ANALYTICAL BREAKDOWN ===
{rep_qwen if rep_qwen else 'No Qwen analytical data.'}

=== SUB-AGENT RESEARCH REPORT 4: META LLAMA 3.3 70B INTELLIGENCE ===
{rep_llama if rep_llama else 'No Llama intelligence data.'}

Instructions for Supreme Judge:
1. First, inside <think>...</think> tags, write your detailed step-by-step thinking process, cross-examining all 4 reports.
2. DETAILED & COMPREHENSIVE PRICING / PRODUCT BREAKDOWN:
   - When the user asks about PRICES, PRODUCTS, SPECIFICATIONS, or COMPARISONS (e.g., AC, HP, Laptop, Car, etc.):
     * DO NOT give a short or generic summary paragraph!
     * Provide an EXTREMELY DETAILED breakdown combining information from all 4 sub-agent reports.
     * Categorize by product types (e.g., AC Standard vs Low Watt vs Inverter).
     * List specific brand-by-brand price ranges & popular model series (e.g. Daikin, Panasonic, Sharp, LG, Samsung, Gree, Polytron).
     * Include technical specifications (e.g., BTU capacity, Wattage/daya listrik, room area fit in m², refrigerant type R32/R410A).
     * Provide practical buyer tips (e.g., installation cost estimate, compressor warranty, recommended electrical capacity).
3. CLEAN STRUCTURE & ELEGANT FORMATTING:
   - Use structured WhatsApp formatting (bullet points, clear headers with bold/asterisks like *1. Tipe Standard*, *2. Tipe Inverter*, bold brand names).
   - DO NOT include raw HTTP URLs, markdown link brackets like [Text](http...), or raw citation brackets [1][2]. Reference news/sources cleanly by name if relevant.
4. After the </think> tag, provide your clean, highly detailed, untruncated, comprehensive, and accurate response for the user in the language of the prompt."""

    reply = ""
    used_model = ""
    reasoning_text = ""
    
    # Priority 1: Groq DeepSeek R1 Distill (Ultra Fast + Reasoning)
    groq_judge_models = [
        "deepseek-r1-distill-llama-70b",
        "llama-3.3-70b-versatile"
    ]
    for gm in groq_judge_models:
        try:
            print(f"⚖️ Evaluating via Chief Judge Model (Groq Direct): {gm}...")
            raw_res = call_groq(gm, [{"role": "user", "content": judge_prompt}], groq_key=groq_key, max_tokens=3000, timeout=30)
            if raw_res:
                think_match = re.search(r'<think>(.*?)</think>', raw_res, re.DOTALL)
                if think_match:
                    reasoning_text = think_match.group(1).strip()
                    raw_res = re.sub(r'<think>.*?</think>', '', raw_res, flags=re.DOTALL).strip()
                reply = raw_res
                used_model = f"groq/{gm}"
                break
        except Exception as err:
            print(f"⚠️ Judge Groq {gm} error: {err}")

    # Priority 2: Gemini Direct
    if not reply:
        try:
            print(f"⚖️ Evaluating via Chief Judge Model (Gemini Direct)...")
            gem_res = call_gemini(judge_prompt, gemini_key=gemini_key, enable_search=False, timeout=30)
            if gem_res:
                think_match = re.search(r'<think>(.*?)</think>', gem_res, re.DOTALL)
                if think_match:
                    reasoning_text = think_match.group(1).strip()
                    gem_res = re.sub(r'<think>.*?</think>', '', gem_res, flags=re.DOTALL).strip()
                reply = gem_res
                used_model = "google/gemini-2.0-flash-direct"
        except Exception as err:
            print(f"⚠️ Judge Gemini Direct error: {err}")

    # Priority 3: OpenRouter Fallback
    if not reply and OPENROUTER_KEY:
        judge_models = ["deepseek/deepseek-r1", "qwen/qwen-2.5-72b-instruct", "meta-llama/llama-3.3-70b-instruct", "openrouter/auto"]
        for judge_model in judge_models:
            try:
                print(f"⚖️ Evaluating via Chief Judge Model (OpenRouter): {judge_model}...")
                res = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_KEY}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://github.com/NousResearch/hermes-agent",
                        "X-Title": "Hermes Agent Gateway"
                    },
                    json={"model": judge_model, "messages": [{"role": "user", "content": judge_prompt}], "max_tokens": 3500},
                    timeout=35
                )
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices and isinstance(choices, list) and len(choices) > 0:
                        choice = choices[0]
                        msg_obj = choice.get("message", {})
                        reasoning_text = msg_obj.get("reasoning") or choice.get("reasoning") or ""
                        raw_text = (msg_obj.get("content") or "").strip()
                        think_match = re.search(r'<think>(.*?)</think>', raw_text, re.DOTALL)
                        if think_match:
                            reasoning_text = think_match.group(1).strip()
                            raw_text = re.sub(r'<think>.*?</think>', '', raw_text, flags=re.DOTALL).strip()
                        if raw_text:
                            reply = raw_text
                            used_model = data.get("model", judge_model)
                            break
            except Exception as err:
                print(f"⚠️ Judge OpenRouter {judge_model} error: {err}")

    # Ultimate Fail-Safe Execution if all sub-agents and judges failed
    if not reply:
        reply = rep_web or rep_gemini or rep_llama or rep_qwen
        
    if not reply and OPENROUTER_KEY:
        print("🛡️ [Fail-Safe] Calling direct openrouter/auto engine...")
        reply = call_openrouter("openrouter/auto", messages, max_tokens=1500, timeout=20)
        used_model = "openrouter/auto-failsafe"
    elif not used_model:
        used_model = "fallback-swarm"

    # Make sure any residual <think> tags are stripped from output body
    reply = re.sub(r'<think>.*?</think>', '', reply, flags=re.DOTALL).strip()

    judge_elapsed = time.time() - judge_start
    total_elapsed = time.time() - overall_start
    duration_formatted = format_duration(judge_elapsed)
    
    if reasoning_text:
        print(f"💭 [Reasoning Extracted] ({len(reasoning_text)} chars): \"{reasoning_text[:150]}...\"")
    print(f"✅ [Supreme Judge Synthesis Complete] Reasoning Time: {duration_formatted} | Total Research Time: {total_elapsed:.2f}s")
    
    cleaned_body = clean_whatsapp_text(reply)
    
    if not cleaned_body:
        cleaned_body = "Mohon maaf, layanan AI Hermes sedang sibuk atau mengalami kendala koneksi ke provider model. Silakan coba beberapa saat lagi."

    # Prepend Reasoning Header ONLY if reasoning mode is active AND reasoning text is available
    if is_reasoning_active and reasoning_text:
        reasoning_header = f"⏱️ *Thought for {duration_formatted}*\n\n"
        final_reply = reasoning_header + cleaned_body
    else:
        final_reply = cleaned_body

    # Save session history
    chat_sessions[user_jid].append({"role": "user", "content": prompt_clean})
    chat_sessions[user_jid].append({"role": "assistant", "content": cleaned_body})
    if len(chat_sessions[user_jid]) > 20:
        chat_sessions[user_jid] = chat_sessions[user_jid][-20:]
    save_mem()
    
    print(f"✨ [{t_stamp}] Final Research Response Delivered | Chief Judge: {used_model} | Output: {len(final_reply)} chars")
    print(f"   Preview: \"{final_reply[:180]}...\"")
    print(f"==================================================\n")
    
    return final_reply


with gr.Blocks(title="Hermes Agent Gateway") as demo:
    gr.Markdown("# 🤖 Official NousResearch Hermes Agent Gateway")
    gr.Markdown("✅ **API Live** — 4 Sub-Agent Swarm (Perplexity Web + Gemini + Qwen 72B + Llama 3.3) -> DeepSeek R1 Supreme Judge")
    with gr.Row():
        jid_box = gr.Textbox(label="User JID", value="TestUser")
        msg_box = gr.Textbox(label="Prompt")
        reasoning_box = gr.Checkbox(label="Enable Reasoning", value=True)
    btn = gr.Button("Send")
    out_box = gr.Textbox(label="Response")
    btn.click(fn=hermes_chat, inputs=[jid_box, msg_box, reasoning_box], outputs=out_box, api_name="hermes_chat")

# Patch gr.routes.App.create_app so custom routes are injected into the FastAPI app when Gradio initializes it
from fastapi import Request  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore
from fastapi.routing import APIRoute  # type: ignore
import gradio.routes as _gr_routes  # type: ignore

_orig_create_app = _gr_routes.App.create_app

def _patched_create_app(*args, **kwargs):
    app = _orig_create_app(*args, **kwargs)

    @app.post("/v1/chat/completions")
    @app.post("/api/v1/chat/completions")
    async def openai_completions(request: Request):
        try:
            body = await request.json()
            user_jid = body.get("user", "api_user")
            messages = body.get("messages", [])
            reasoning = body.get("reasoning")
            last_msg = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
            groq_key = body.get("groq_api_key") or request.headers.get("X-Groq-Api-Key", "")
            gemini_key = body.get("gemini_api_key") or request.headers.get("X-Gemini-Api-Key", "")
            reply = hermes_chat(user_jid, last_msg, reasoning=reasoning, groq_key=groq_key, gemini_key=gemini_key)
            return JSONResponse({
                "id": f"cmpl-{int(time.time())}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "hermes-multi-agent-swarm",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": reply},
                    "finish_reason": "stop"
                }]
            })
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.post("/api/reasoning")
    @app.post("/v1/reasoning")
    async def set_reasoning_endpoint(request: Request):
        try:
            body = await request.json()
            user_jid = body.get("user") or body.get("chat_id") or "default"
            enabled = bool(body.get("reasoning", True))
            reasoning_sessions[user_jid] = enabled
            save_reasoning_mem()
            return JSONResponse({
                "status": "ok",
                "user": user_jid,
                "reasoning": enabled
            })
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.get("/api/reasoning")
    @app.get("/v1/reasoning")
    async def get_reasoning_endpoint(user: str = "default"):
        enabled = reasoning_sessions.get(user, True)
        return JSONResponse({
            "status": "ok",
            "user": user,
            "reasoning": enabled
        })

    @app.get("/api/status")
    @app.get("/v1/models")
    def status_endpoint():
        return {
            "status": "online",
            "service": "Hermes Multi-Agent Swarm Gateway",
            "date": get_current_time_str(),
            "swarm_workers": [
                "1️⃣ Perplexity Real-Time Web Search",
                "2️⃣ Gemini Global Knowledge",
                "3️⃣ Qwen 2.5 72B Analytics",
                "4️⃣ Meta Llama 3.3 70B Intelligence"
            ],
            "chief_judge": "DeepSeek R1 (Reasoning Engine)"
        }

    api_routes = [r for r in app.router.routes if isinstance(r, APIRoute) and ("/v1" in getattr(r, "path", "") or "/api" in getattr(r, "path", ""))]
    other_routes = [r for r in app.router.routes if r not in api_routes]
    app.router.routes = api_routes + other_routes

    print("🚀 [FastAPI Gateway] Multi-Subagent Research Swarm /v1/chat/completions & /v1/reasoning routes registered!")
    return app

_gr_routes.App.create_app = _patched_create_app

demo.launch()
