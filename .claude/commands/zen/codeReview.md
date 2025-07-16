# Code Review Workflow

## Description

COMPREHENSIVE CODE REVIEW WORKFLOW - Step-by-step code review with expert analysis. This tool guides you through a systematic investigation process for thorough code examination, issue identification, and quality assessment.

The workflow enforces investigation between steps to ensure comprehensive analysis across security, performance, architecture, and maintainability dimensions. Each step builds upon previous findings with concrete evidence from actual code analysis.

## Key Features

- Step-by-step code review workflow with progress tracking
- Context-aware file embedding (references during investigation, full content for analysis)
- Automatic issue tracking with severity classification
- Expert analysis integration with external models
- Support for focused reviews (security, performance, architecture)
- Confidence-based workflow optimization

## Workflow Process

1. **Start with step 1**: Describe your code review investigation plan
2. **STOP and investigate**: Examine code structure, patterns, and potential issues
3. **Report findings in step 2**: Provide concrete evidence from actual code analysis
4. **Continue investigating**: Between each step, gather more evidence
5. **Track findings**: Document relevant files, issues, and code elements throughout
6. **Update assessments**: Evolve understanding as investigation progresses
7. **Complete review**: Once investigation is complete, receive expert analysis

## Required Parameters

### Step Information
- **step**: Current investigation description with deep analysis of code structure, patterns, and potential issues
- **step_number**: Index of current step in sequence (starts at 1)
- **total_steps**: Estimated number of steps needed (adjust as findings emerge)
- **next_step_required**: Boolean indicating if another step is planned

### Investigation Tracking
- **findings**: Summary of everything discovered in current step about code quality, security, performance, architecture, and maintainability
- **files_checked**: List of all files examined (absolute paths)
- **relevant_files**: For step 1 - files to review; for final step - subset with significant findings
- **relevant_context**: Methods, functions, classes central to review findings (format: 'ClassName.methodName')
- **issues_found**: Array of issues with 'severity' (critical/high/medium/low) and 'description' fields
- **confidence**: Current assessment confidence (exploring/low/medium/high/very_high/almost_certain/certain)

## Optional Parameters

### Review Configuration (Step 1 Only)
- **review_type**: Type of review (full/security/performance/quick) - default: full
- **focus_on**: Specific aspects to focus on or areas of concern
- **standards**: Coding standards to enforce during review
- **severity_filter**: Minimum severity level to report (critical/high/medium/low/all) - default: all

### Advanced Options
- **backtrack_from_step**: Step number to restart from if earlier findings need revision
- **images**: Absolute paths to architecture diagrams or visual references

## Confidence Levels

- **exploring**: Starting analysis
- **low**: Early investigation
- **medium**: Some evidence gathered
- **high**: Strong evidence
- **very_high**: Very strong evidence
- **almost_certain**: Nearly complete review
- **certain**: 100% confidence - prevents external model validation

## Issue Severity Classifications

- **critical**: Security vulnerabilities, data corruption risks
- **high**: Performance bottlenecks, major design flaws
- **medium**: Code quality issues, maintainability concerns
- **low**: Minor improvements, style issues

## Example Usage

### Initial Code Review
```
step: "Beginning comprehensive code review of authentication module. Will examine security patterns, input validation, session management, and identify potential vulnerabilities or architectural concerns."
step_number: 1
total_steps: 3
next_step_required: true
findings: "Initial assessment shows complex authentication flow with multiple entry points. Need to examine JWT handling, password validation, and session storage patterns."
relevant_files: ["/path/to/auth.py", "/path/to/middleware.py"]
review_type: "security"
focus_on: "Authentication security and session management"
confidence: "exploring"
```

### Investigation Step
```
step: "Examined authentication middleware and found several security concerns. Investigating JWT token validation, password hashing implementation, and session timeout mechanisms."
step_number: 2
total_steps: 3
next_step_required: true
findings: "Identified weak password validation, missing rate limiting on login attempts, and potential JWT token replay vulnerability. Session timeout not properly implemented."
files_checked: ["/path/to/auth.py", "/path/to/middleware.py", "/path/to/session.py"]
relevant_files: ["/path/to/auth.py", "/path/to/middleware.py"]
relevant_context: ["AuthMiddleware.validate_token", "UserAuth.check_password"]
issues_found: [
  {"severity": "high", "description": "Missing rate limiting on login attempts allows brute force attacks"},
  {"severity": "medium", "description": "Weak password validation - no complexity requirements"}
]
confidence: "medium"
```

### Final Assessment
```
step: "Completed comprehensive security review. All critical vulnerabilities identified and documented with specific remediation steps."
step_number: 3
total_steps: 3
next_step_required: false
findings: "Security review complete. Found 1 critical, 2 high, 3 medium severity issues. Primary concerns are authentication bypass vulnerability and insufficient input validation."
files_checked: ["/path/to/auth.py", "/path/to/middleware.py", "/path/to/session.py", "/path/to/utils.py"]
relevant_files: ["/path/to/auth.py", "/path/to/middleware.py"]
relevant_context: ["AuthMiddleware.validate_token", "UserAuth.check_password", "SessionManager.create_session"]
issues_found: [
  {"severity": "critical", "description": "Authentication bypass possible through JWT token manipulation"},
  {"severity": "high", "description": "Missing rate limiting on login attempts"},
  {"severity": "high", "description": "Insufficient input validation in password reset flow"}
]
confidence: "very_high"
```

## Investigation Requirements

### Step 1 - Initial Investigation
- Read and understand specified code files
- Examine overall structure, architecture, and design patterns
- Identify main components, classes, and functions
- Understand business logic and intended functionality
- Look for obvious issues: bugs, security concerns, performance problems
- Note code smells, anti-patterns, or areas of concern

### Low/Medium Confidence - Deeper Analysis
- Examine specific concerning code sections
- Analyze security implications: input validation, authentication, authorization
- Check performance issues: algorithmic complexity, resource usage
- Look for architectural problems: tight coupling, missing abstractions
- Identify code quality issues: readability, maintainability, error handling
- Search for over-engineering, unnecessary complexity

### High Confidence - Final Verification
- Verify all identified issues are documented with severity levels
- Check for missed critical security vulnerabilities or performance bottlenecks
- Confirm architectural concerns and code quality issues are captured
- Ensure positive aspects and well-implemented patterns are noted
- Validate assessment aligns with review type and focus areas
- Double-check findings are actionable with clear improvement guidance

## Important Notes

- **MANDATORY**: Do not call codereview again immediately - investigate first
- Each step must include NEW evidence from code examination
- No recursive calls without actual investigation work
- Follow required_actions list for investigation guidance
- Document both positive findings and concerns
- Provide specific file references and line numbers where applicable
- Use 'certain' confidence only when 100% complete (prevents external validation)

## Completion Criteria

Review is complete when:
- All significant issues identified across severity levels
- Investigation covers security, performance, architecture, and maintainability
- Findings include specific code locations and actionable recommendations
- Confidence level reflects thoroughness of analysis
- Top 3 priority issues clearly identified for immediate attention