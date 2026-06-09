# Broken Document

This document contains broken component references that should be caught.

Line below has unknown component:
@ST:DoesNotExist

Line below has valid component but invalid section:
@ST:Alpha:InvalidSection

Mixed valid and invalid on same line:
@ST:Beta and @ST:BadComponent:WrongSection
