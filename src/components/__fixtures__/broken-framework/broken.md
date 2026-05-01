# Broken Document

This document contains broken component references that should be caught.

Line below has unknown component:
@ST:DoesNotExist

Line below has valid component but invalid section:
@ST:Alpha:InvalidSection

Line below uses legacy syntax with broken ref:
<JDI:LegacyComponent />

Mixed valid and invalid on same line:
@ST:Beta and @ST:BadComponent:WrongSection

Another legacy broken ref:
<JDI:Architect:Analyse />
