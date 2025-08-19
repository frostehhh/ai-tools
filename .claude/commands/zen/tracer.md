# Tracer - Step-by-Step Code Tracing and Dependency Analysis

## Description

The Tracer tool provides a structured workflow for comprehensive code tracing and dependency analysis. It guides you through systematic investigation steps with forced pauses between each step to ensure thorough code examination, dependency mapping, and execution flow analysis.

This tool implements a sequential tracing approach with full context awareness and the ability to revise and adapt as understanding deepens. It supports both precision tracing (execution flow) and dependencies tracing (structural relationships).

## Key Features

- **Sequential Tracing**: Systematic investigation workflow with step-by-step analysis
- **Dual Trace Modes**: Precision mode for execution flow and dependencies mode for structural relationships
- **Self-Contained Analysis**: Comprehensive guidance without external expert analysis
- **Context-Aware**: Builds understanding incrementally through each investigation step
- **Detailed Output Formatting**: Specific rendering instructions for different trace modes

## Usage

The tracer tool guides you through a structured investigation process:

1. **Step 1**: Describe your tracing plan and target (prompts for mode selection if needed)
2. **Investigation Phase**: Stop and investigate code structure, patterns, and relationships
3. **Evidence Gathering**: Report findings with concrete evidence from code analysis
4. **Iterative Analysis**: Continue investigating between each step
5. **Comprehensive Understanding**: Build complete understanding as analysis evolves
6. **Detailed Output**: Complete with formatted results according to trace mode

## Parameters

### Required Parameters

- **target_description** (string): Detailed description of what to trace and WHY you need this analysis. Must include context about what you're trying to understand, debug, analyze, or find.
- **trace_mode** (string): Type of tracing analysis to perform

### Workflow Parameters

- **step** (string): Current investigation step description with deep thinking about code structure, execution paths, and dependencies
- **step_number** (integer): Index of current step in tracing sequence (starts at 1)
- **total_steps** (integer): Current estimate of steps needed to complete analysis
- **next_step_required** (boolean): Whether to continue with another investigation step
- **findings** (string): Summary of discoveries in current step about code being traced
- **files_checked** (array): List of all files examined during investigation (absolute paths)
- **relevant_files** (array): Subset of files_checked containing directly relevant code (absolute paths)
- **relevant_context** (array): Methods, functions, classes, or modules central to the tracing analysis
- **confidence** (string): Current confidence level in tracing analysis completeness

### Optional Parameters

- **images** (array): Optional system architecture diagrams, flow charts, or visual references

## Trace Modes

### Ask Mode (Default)
- **Value**: "ask"
- **Behavior**: Prompts user to choose between precision or dependencies modes with explanations
- **Use Case**: When you're unsure which analysis type is most appropriate

### Precision Mode
- **Value**: "precision"
- **Focus**: Execution flow, call chains, and usage patterns
- **Best For**: Methods/functions analysis
- **Output**: Vertical indented flow diagrams with call sequences using MermaidJS

### Dependencies Mode
- **Value**: "dependencies"
- **Focus**: Structural relationships and bidirectional dependencies
- **Best For**: Classes/modules analysis
- **Output**: Bidirectional arrow flow diagrams showing incoming/outgoing dependencies using MermaidJS

## Confidence Levels

- **exploring**: Starting analysis phase
- **low**: Early investigation with basic understanding
- **medium**: Some patterns identified, partial understanding
- **high**: Comprehensive understanding achieved
- **very_high**: Very comprehensive understanding
- **almost_certain**: Nearly complete tracing analysis
- **certain**: 100% confidence - analysis finished and ready for output

## Example Usage

### Basic Tracer Call (Ask Mode)
```
tracer:
target_description: "I need to understand how the user authentication flow works in this application, specifically how login requests are processed and what validation steps occur."
trace_mode: "ask"
step: "Starting analysis of user authentication flow"
step_number: 1
total_steps: 3
next_step_required: true
findings: "Initial investigation phase - need to locate authentication components"
confidence: "exploring"
```

### Precision Mode Analysis
```
tracer:
target_description: "Trace the execution flow of the processPayment method to understand how payment processing works and identify all the steps involved"
trace_mode: "precision"
step: "Investigating processPayment method execution flow and call chains"
step_number: 2
total_steps: 4
next_step_required: true
findings: "Found processPayment method in PaymentService class, identified initial validation steps and database interactions"
files_checked: ["/src/services/PaymentService.java", "/src/models/Payment.java"]
relevant_files: ["/src/services/PaymentService.java"]
relevant_context: ["PaymentService.processPayment", "PaymentValidator.validate"]
confidence: "medium"
```

### Dependencies Mode Analysis
```
tracer:
target_description: "Map the structural relationships and dependencies for the UserManager class to understand what components depend on it and what it depends on"
trace_mode: "dependencies"
step: "Analyzing UserManager class structural relationships and bidirectional dependencies"
step_number: 3
total_steps: 5
next_step_required: true
findings: "UserManager depends on UserRepository, EmailService, and SecurityService. Found 8 classes that depend on UserManager for user operations"
files_checked: ["/src/managers/UserManager.java", "/src/repositories/UserRepository.java", "/src/services/EmailService.java"]
relevant_files: ["/src/managers/UserManager.java", "/src/repositories/UserRepository.java"]
relevant_context: ["UserManager", "UserRepository", "EmailService.sendWelcomeEmail"]
confidence: "high"
```

## Output Formats

### Precision Mode Output
The tracer provides specific rendering instructions for precision mode:

- **Vertical Indented Flow Style**: Call flow diagrams with proper indentation using MermaidJS
- **Branching & Side Effect Tables**: Conditional logic and side effects analysis
- **Usage Points**: Context descriptions of where/why methods are called
- **Entry Points**: Starting points for the execution flow

### Dependencies Mode Output
The tracer provides specific rendering instructions for dependencies mode:

- **Bidirectional Arrow Flow Style**: Incoming and outgoing dependencies
- **Type Relationships**: Implementation, inheritance, and usage relationships
- **Dependency Tables**: Structured relationship information with file references

## Workflow Process

### Step 1: Initialization
- If trace_mode is "ask", prompt user for mode selection
- Define target description and investigation plan
- Begin initial code examination

### Investigation Steps (2-N)
- Examine code structure and relationships
- Gather evidence from actual code analysis
- Document findings with specific file references
- Update confidence level based on discoveries

### Completion
- Comprehensive analysis with detailed output formatting
- Mode-specific rendering instructions
- Complete trace results with file references and line numbers

## Best Practices

1. **Thorough Investigation**: Take time between steps to actually examine code
2. **Specific Evidence**: Document findings with concrete file references and line numbers
3. **Incremental Understanding**: Build knowledge step by step rather than jumping to conclusions
4. **Mode Selection**: Choose precision for execution flow, dependencies for structural analysis
5. **Confidence Management**: Only use "certain" when analysis is truly complete

## Completion Criteria

The tracer analysis is complete when:
- All significant code relationships have been traced
- Execution paths or dependency structures are fully mapped
- Findings include specific file references and line numbers
- Confidence level indicates comprehensive understanding
- Output formatting instructions are provided for final presentation

## Perfect Use Cases

- **Method Execution Flow Analysis**: Understanding how specific methods work
- **Dependency Mapping**: Structural relationships between classes/modules
- **Call Chain Tracing**: Following execution paths through the codebase
- **Architectural Understanding**: Comprehending component relationships
- **Code Comprehension**: Deep analysis of unfamiliar code sections
- **Debugging Support**: Tracing execution paths for troubleshooting