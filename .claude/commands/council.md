---
description: Invoke council review for architectural decisions
---

# /council - Multi-Perspective Review

Invoke the council for architectural decisions.

## Usage

```
/council [topic]
```

## Process

### 1. IDENTIFY TOPIC

Determine what's being reviewed:
- Architecture decision
- Performance approach
- Security concern
- API design
- Database schema
- Event system design
- Plugin interface

### 2. SELECT MEMBERS

Route to relevant council members:

| Topic | Members |
|-------|---------|
| Architecture | questioner, architect, simplifier, benchmarker |
| Performance | benchmarker, questioner, architect, measurer |
| Security | sentinel, questioner, simplifier |
| API Design | ergonomist, questioner, simplifier, deployer |
| Database | architect, benchmarker, questioner |
| Events | architect, tracer, measurer |
| Operations | operator, tracer, measurer |
| Deployment | deployer, operator, simplifier |
| Full Review | all 10 members |
| Default | questioner, simplifier, architect |

### 3. GATHER PERSPECTIVES

For each selected member:
```
1. Apply their philosophy
2. Evaluate the topic
3. Provide 2-3 key points
4. Cast vote: APPROVE / REJECT / MODIFY
5. Note specific concerns
```

### 4. SYNTHESIZE

```
1. Combine all perspectives
2. Identify common themes
3. Count votes
4. Determine consensus level
5. Provide recommendation
```

## Output

```markdown
# Council Review: [Topic]

## Members Invoked
- [Member 1]: [Why relevant]
- [Member 2]: [Why relevant]

## Perspectives

### [Member 1]
**Vote:** APPROVE/REJECT/MODIFY
- Point 1
- Point 2
[Concerns if any]

### [Member 2]
**Vote:** APPROVE/REJECT/MODIFY
- Point 1
- Point 2
[Concerns if any]

## Synthesis

**Consensus:** Strong/Weak/Split
**Votes:** X APPROVE, Y MODIFY, Z REJECT

**Key Themes:**
1. [Theme 1]
2. [Theme 2]

**Recommendation:** [Advisory]
```

## Remember

- Council is advisory, not blocking
- Final decision is with the human
- Default to core trio for quick reviews
- Full council for major decisions
