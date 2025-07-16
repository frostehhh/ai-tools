# Debug & Root Cause Analysis

## Description

A systematic debugging tool for comprehensive issue investigation and root cause analysis. This tool guides you through a structured, step-by-step investigation process that ensures thorough code examination and evidence gathering before reaching conclusions. It's designed for complex debugging scenarios including race conditions, memory leaks, performance issues, and integration problems.

## Workflow

The debug tool implements a structured investigation workflow:

1. **Initial Issue Description**: Start with step 1 to describe the issue being investigated
2. **Investigation Pause**: After each debug step, you MUST investigate using appropriate tools
3. **Evidence Gathering**: Report concrete findings from actual code examination
4. **Progressive Analysis**: Continue investigation between each debug step
5. **Hypothesis Evolution**: Track findings, relevant files, and methods throughout the process
6. **Root Cause Identification**: Update hypotheses as understanding evolves
7. **Expert Analysis**: Once investigation is complete, receive expert analysis validation

## Key Features

- **Systematic Investigation**: Step-by-step workflow with progress tracking
- **Context-Aware File Embedding**: References during investigation, full content for analysis
- **Conversation Threading**: Automatic conversation history preservation
- **Expert Analysis Integration**: External model validation with extended reasoning
- **Visual Debugging Support**: Screenshot and UI visual context integration
- **Confidence-Based Workflow**: Optimization based on investigation confidence levels
- **Backtracking Support**: Ability to revise earlier findings and hypotheses

## Parameters

### Required Parameters

#### `step` (string)
Describe what you're currently investigating by thinking deeply about the issue and its possible causes. In step 1, clearly state the issue and begin forming an investigative direction. Ask further questions from the user if needed for understanding.

**Critical Guidelines:**
- Remember that reported symptoms might originate from code far from where they manifest
- After thorough investigation, you might find NO BUG EXISTS - could be misunderstanding or expectation mismatch
- Consider not only obvious failures, but also subtle contributing factors like upstream logic, invalid inputs, missing preconditions, or hidden side effects
- Map out the flow of related functions or modules
- Identify call paths where input values or branching logic could cause instability
- In concurrent systems, watch for race conditions, shared state, or timing dependencies

#### `step_number` (integer)
The index of the current step in the investigation sequence, beginning at 1. Each step should build upon or revise the previous one.

#### `total_steps` (integer)
Your current estimate for how many steps will be needed to complete the investigation. Adjust as new findings emerge.

#### `next_step_required` (boolean)
Set to `true` if you plan to continue the investigation with another step. `false` means you believe the root cause is known or the investigation is complete.

#### `findings` (string)
Summarize everything discovered in this step. Include new clues, unexpected behavior, evidence from code or logs, or disproven theories. Be specific and avoid vague language.

**Important Notes:**
- Document what you now know and how it affects your hypothesis
- If you find no evidence supporting the reported issue after thorough investigation, document this clearly
- Finding 'no bug' is a valid outcome if the investigation was comprehensive
- In later steps, confirm or disprove past findings with reasoning

### Investigation Tracking Parameters

#### `files_checked` (array of strings)
List all files (as absolute paths) examined during the investigation so far. Include even files ruled out, as this tracks your exploration path.

#### `relevant_files` (array of strings)
Subset of `files_checked` (as full absolute paths) that contain code directly relevant to the issue. Only list those directly tied to the root cause or its effects.

#### `relevant_context` (array of strings)
List methods or functions that are central to the issue, in the format `ClassName.methodName` or `functionName`. Prioritize those that influence or process inputs, drive branching, or pass state between modules.

#### `hypothesis` (string)
A concrete theory for what's causing the issue based on the evidence so far. This can include suspected failures, incorrect assumptions, or violated constraints.

**Valid Hypotheses Include:**
- "No bug found - possible user misunderstanding"
- "Symptoms appear unrelated to any code issue"
- When no bug is found, consider suggesting: "Recommend discussing with thought partner/engineering assistant for clarification of expected behavior"

You are encouraged to revise or abandon hypotheses in later steps as needed based on evidence.

### Optional Parameters

#### `confidence` (string)
Indicate your current confidence in the hypothesis. Available options:
- `exploring`: Starting out, forming initial understanding
- `low`: Early idea, limited evidence
- `medium`: Some supporting evidence found
- `high`: Strong evidence supporting hypothesis
- `very_high`: Very strong evidence, high confidence
- `almost_certain`: Nearly confirmed, minimal doubt
- `certain`: 100% confidence - root cause and minimal fix are both confirmed locally

**Important Notes:**
- Do NOT use 'certain' unless the issue can be fully resolved with a fix
- Use 'very_high' or 'almost_certain' when not 100% sure
- Using 'certain' means you have complete confidence locally and prevents external model validation
- Do NOT set confidence to 'certain' if the user has strongly requested that external validation MUST be performed

#### `backtrack_from_step` (integer)
If an earlier finding or hypothesis needs to be revised or discarded, specify the step number from which to start over. Use this to acknowledge investigative dead ends and correct the course.

#### `images` (array of strings)
Optional list of absolute paths to screenshots or UI visuals that clarify the issue. Only include if they materially assist understanding or hypothesis formulation.

### Model Configuration

#### `model` (string)
Choose the AI model for analysis:
- `flashlite`: Fast, lightweight analysis
- `flash`: Balanced performance and capability
- `o3`: Advanced reasoning for complex issues
- `claude`: Extended reasoning capabilities
- `custom`: Use custom model configuration

## Example Usage

### Initial Investigation (Step 1)
```
step: "User reports that the login function is failing intermittently. Users sometimes get redirected to a blank page instead of the dashboard after successful authentication. This happens roughly 30% of the time according to user reports."
step_number: 1
total_steps: 3
next_step_required: true
findings: "Initial issue reported - intermittent login failure with blank page redirection. Need to investigate authentication flow and redirect logic."
files_checked: []
relevant_files: []
relevant_context: []
hypothesis: "Possible race condition in authentication redirect or session handling"
confidence: "exploring"
```

### Mid-Investigation (Step 2)
```
step: "Investigated authentication flow and found potential issue in session handling during redirect"
step_number: 2
total_steps: 4
next_step_required: true
findings: "Examined auth.py, session_manager.py, and redirect_handler.py. Found that session.save() is called after redirect headers are sent, which could cause race condition. Also discovered missing error handling in redirect_handler.py for edge cases."
files_checked: ["/app/auth/auth.py", "/app/session/session_manager.py", "/app/handlers/redirect_handler.py", "/app/middleware/auth_middleware.py"]
relevant_files: ["/app/session/session_manager.py", "/app/handlers/redirect_handler.py"]
relevant_context: ["SessionManager.save_session", "RedirectHandler.handle_post_auth", "AuthMiddleware.process_redirect"]
hypothesis: "Race condition between session.save() and redirect response, combined with missing error handling for failed session saves"
confidence: "high"
```

### Final Investigation (Step 3)
```
step: "Confirmed root cause and identified minimal fix for the authentication redirect issue"
step_number: 3
total_steps: 3
next_step_required: false
findings: "Confirmed that session.save() is called asynchronously after redirect headers are sent in RedirectHandler.handle_post_auth(). When session save fails or is delayed, user gets redirected to blank page. The fix is to ensure session.save() completes before sending redirect headers."
files_checked: ["/app/auth/auth.py", "/app/session/session_manager.py", "/app/handlers/redirect_handler.py", "/app/middleware/auth_middleware.py", "/app/tests/test_auth.py"]
relevant_files: ["/app/handlers/redirect_handler.py", "/app/session/session_manager.py"]
relevant_context: ["RedirectHandler.handle_post_auth", "SessionManager.save_session", "SessionManager.ensure_session_ready"]
hypothesis: "Race condition in RedirectHandler.handle_post_auth() where session.save() is called after redirect headers are sent, causing intermittent blank page redirects when session save fails or is delayed"
confidence: "certain"
```

### Investigation with Visual Context
```
step: "Investigating UI rendering issue with dashboard components not loading properly"
step_number: 2
total_steps: 3
next_step_required: true
findings: "User provided screenshot showing blank dashboard area. Investigated component loading logic and found potential issue with lazy loading timeout in ComponentLoader.js"
files_checked: ["/frontend/components/Dashboard.js", "/frontend/utils/ComponentLoader.js", "/frontend/services/api.js"]
relevant_files: ["/frontend/utils/ComponentLoader.js", "/frontend/components/Dashboard.js"]
relevant_context: ["ComponentLoader.loadAsync", "Dashboard.componentDidMount", "Dashboard.handleLoadTimeout"]
hypothesis: "ComponentLoader timeout is too aggressive, causing components to fail loading on slower connections"
confidence: "medium"
images: ["/path/to/screenshot_blank_dashboard.png", "/path/to/screenshot_console_errors.png"]
```

### Backtracking Example
```
step: "Backtracking from previous hypothesis as new evidence contradicts initial theory"
step_number: 4
total_steps: 5
next_step_required: true
findings: "Further investigation revealed that the database connection pooling issue I suspected is not the root cause. The real issue appears to be in the caching layer where stale cache entries are being returned for user sessions."
files_checked: ["/app/database/connection_pool.py", "/app/cache/redis_cache.py", "/app/cache/cache_manager.py", "/app/models/user_session.py"]
relevant_files: ["/app/cache/redis_cache.py", "/app/cache/cache_manager.py"]
relevant_context: ["RedisCache.get_user_session", "CacheManager.invalidate_session", "UserSession.refresh_cache"]
hypothesis: "Stale cache entries in Redis are causing authentication failures when user sessions are not properly invalidated"
confidence: "high"
backtrack_from_step: 2
```

## Usage Guidelines

### Investigation Process

1. **Start with Step 1**: Clearly describe the issue and begin investigation
2. **Mandatory Investigation**: After each debug call, you MUST investigate using appropriate tools
3. **Evidence-Based Findings**: Each step must include NEW evidence from code examination
4. **No Recursive Calls**: No recursive debug calls without actual investigation work
5. **Progressive Understanding**: Build upon previous findings and evolve hypotheses
6. **Confidence Tracking**: Adjust confidence levels based on gathered evidence

### Required Actions by Investigation Phase

#### Step 1 (Initial Investigation)
- Search for code related to the reported issue or symptoms
- Examine relevant files and understand the current implementation
- Understand the project structure and locate relevant modules
- Identify how the affected functionality is supposed to work

#### Low Confidence (exploring, low)
- Examine the specific files you've identified as relevant
- Trace method calls and data flow through the system
- Check for edge cases, boundary conditions, and assumptions in the code
- Look for related configuration, dependencies, or external factors

#### Medium to High Confidence (medium, high, very_high)
- Examine the exact code sections where you believe the issue occurs
- Trace the execution path that leads to the failure
- Verify your hypothesis with concrete code evidence
- Check for any similar patterns elsewhere in the codebase

#### Almost Certain Confidence
- Finalize your root cause analysis with specific evidence
- Document the complete chain of causation from symptom to root cause
- Verify the minimal fix approach is correct
- Consider if expert analysis would provide additional insights

### Completion Criteria

The investigation is complete when:
- Root cause is identified with high confidence
- Evidence supports the hypothesis conclusively
- Minimal fix approach is confirmed
- All relevant files and methods are documented
- Expert analysis validation is completed (if required)

### Important Reminders

- **Symptoms vs. Root Cause**: Reported symptoms might originate from code far from where they manifest
- **No Bug Found**: After thorough investigation, it's possible NO BUG EXISTS - could be misunderstanding or expectation mismatch
- **Evidence Required**: Each step must include concrete evidence from actual code examination
- **Investigation Pause**: Must pause and investigate between each debug step
- **Expert Analysis**: Available for validation when confidence is not certain
- **Visual Context**: Screenshots and UI visuals can provide valuable debugging context

This tool enforces systematic investigation practices to ensure thorough analysis and accurate root cause identification for complex debugging scenarios.