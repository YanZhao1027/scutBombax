#!/usr/bin/env sh
# Runs a command with a JDK that has javac.
#
# This workstation's PATH java is a JRE only and there is no sudo to install
# openjdk-21-jdk, so Gradle fails with "[JAVA_COMPILER] ... JRE in use" unless
# JAVA_HOME points at a real JDK (see docs/UBUNTU24.md §9.1). Anything that
# already has a usable javac — CI, Android Studio, a normal dev shell — is left
# exactly as it is.
if ! command -v javac >/dev/null 2>&1 && ! command -v java >/dev/null 2>&1; then
	echo "with-jdk: no java on PATH" >&2
	exit 127
fi

if ! command -v javac >/dev/null 2>&1; then
	for candidate in \
		"$JAVA_HOME" \
		"$HOME/opt/jdk-21.0.12.1+1" \
		/usr/lib/jvm/java-21-openjdk-amd64 \
		/usr/lib/jvm/default-java; do
		if [ -n "$candidate" ] && [ -x "$candidate/bin/javac" ]; then
			JAVA_HOME="$candidate"
			export JAVA_HOME
			PATH="$JAVA_HOME/bin:$PATH"
			export PATH
			break
		fi
	done
fi

if ! command -v javac >/dev/null 2>&1; then
	cat >&2 <<'MSG'
with-jdk: no JDK with javac found.
Install one (sudo apt install openjdk-21-jdk) or point JAVA_HOME at an
unpacked JDK, e.g. the Temurin 21 copy under ~/opt used on this machine.
MSG
	exit 127
fi

exec "$@"
