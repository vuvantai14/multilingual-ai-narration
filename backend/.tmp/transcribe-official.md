> ## AI Agent Context
> Get the complete documentation index at: https://aistudio.google.com/llms.txt
> Use this file to discover all available pages.
> For the full documentation in a single file, fetch: https://aistudio.google.com/llms-full.txt

# Audio transcription

The Gemini API converts speech in audio files into text using the Gemini 3.5 Transcribe model (`gemini-3.5-transcribe`). Based on Gemini's audio understanding capabilities, it delivers accurate transcription with automatic language identification, speaker diarization, word-level timestamps, and custom vocabulary hints. It also provides a [smart transcription](/docs/transcribe#transcription-modes) mode featuring disfluency removal and smart formatting.

To transcribe an audio file, upload the audio and pass it to `gemini-3.5-transcribe`:

{% tabs %}
  {% tab filename="transcribe_quickstart.py" label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  audio_file = client.files.upload(file="path/to/sample.mp3")
  
  response = client.interactions.create(
      model="gemini-3.5-transcribe",
      input=[audio_file],
  )
  
  print(response.output_text)
  ```

  {% /tab %}

  {% tab filename="transcribe_quickstart.js" label="JavaScript" %}
  ```javascript
  import { GoogleGenAI } from "@google/genai";
  
  const ai = new GoogleGenAI({});
  
  const audioFile = await ai.files.upload({
    file: "path/to/sample.mp3",
    config: { mimeType: "audio/mp3" },
  });
  
  const response = await ai.interactions.create({
    model: "gemini-3.5-transcribe",
    input: [
      {
        type: "audio",
        uri: audioFile.uri,
        mime_type: audioFile.mimeType,
      },
    ],
  });
  
  console.log(response.output_text);
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      audioFile, err := client.Files.UploadFromPath(ctx, "path/to/sample.mp3", nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateModelInteraction{
              Model: interactions.Model("gemini-3.5-transcribe"),
              Input: interactions.NewInteractionsInput([]interactions.Content{
                  interactions.NewContent(interactions.AudioContent{
                      URI:      genai.Ptr(audioFile.URI),
                      MimeType: interactions.AudioContentMimeType(audioFile.MIMEType).ToPointer(),
                  }),
              }),
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
  
      fmt.Println(res.Interaction.GetOutputText())
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_quickstart.sh" label="REST" %}
  ```bash
  # First upload the file via the Files API, then pass its URI:
  curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "models/gemini-3.5-transcribe",
      "input": [
        {
          "type": "file",
          "file_uri": "YOUR_FILE_URI"
        }
      ]
    }'
  ```

  {% /tab %}

{% /tabs %}

{% callout type="note" %}
  For real-time, low-latency streaming speech recognition from a microphone or live audio stream, see [Live transcription](/docs/live-api/live-transcribe) using the Live API and `gemini-3.5-transcribe-live`.

{% /callout %}

## Overview  {% id="overview" %}

Gemini 3.5 Transcribe is optimized for speech-to-text tasks. It handles diverse accents, background noise, and multi-language conversations.

Key capabilities include:

*   **Automatic speech recognition (ASR):** Automatically detects languages across [85+ locales](/docs/transcribe#supported-languages). Handles intra-sentence and inter-sentential code-switching without manual configuration.
*   **Custom vocabulary:** Biases recognition toward domain-specific terms, acronyms, and proper names by passing up to 1,000 phrases.
*   **Speaker diarization:** Distinguishes between multiple speakers and attributes spoken segments to distinct labels.
*   **Word-level timestamps:** Generates precise start and end time offsets for each recognized word.
*   **Smart transcription:** Cleans up disfluencies, filler words, repetitions, and applies structured formatting.
*   **Formatting and normalization:** Applies capitalization, punctuation, and inverse text normalization, such as converting "twenty six million dollars" to "$26M".

For general audio reasoning or question answering over audio content, use [Audio understanding](/docs/audio). For text-to-speech audio synthesis, use [Text-to-speech](/docs/speech-generation).

## Language detection and hints  {% id="language-detection" %}

By default, the model detects the spoken language automatically. It switches between languages dynamically when speakers code-switch.

To use automatic detection, omit `language_codes` or provide an empty list:

{% tabs %}
  {% tab filename="transcribe_language_auto.py" label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  response = client.interactions.create(
      model="gemini-3.5-transcribe",
      input=[audio_file],
      generation_config={
          "transcription_config": {
              "language_codes": [],
          }
      },
  )
  ```

  {% /tab %}

  {% tab filename="transcribe_language_auto.js" label="JavaScript" %}
  ```javascript
  const response = await ai.interactions.create({
    model: "gemini-3.5-transcribe",
    input: [audioFile],
    generationConfig: {
      transcriptionConfig: {
        languageCodes: [],
      },
    },
  });
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      audioFile, err := client.Files.UploadFromPath(ctx, "path/to/sample.mp3", nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateModelInteraction{
              Model: interactions.Model("gemini-3.5-transcribe"),
              Input: interactions.NewInteractionsInput([]interactions.Content{
                  interactions.NewContent(interactions.AudioContent{
                      URI:      genai.Ptr(audioFile.URI),
                      MimeType: interactions.AudioContentMimeType(audioFile.MIMEType).ToPointer(),
                  }),
              }),
              GenerationConfig: &interactions.GenerationConfig{
                  TranscriptionConfig: &interactions.TranscriptionConfig{
                      LanguageCodes: []string{},
                  },
              },
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
  
      fmt.Println(res.Interaction.GetOutputText())
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_language_auto.sh" label="REST" %}
  ```bash
  curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "models/gemini-3.5-transcribe",
      "input": [
        {
          "type": "file",
          "file_uri": "YOUR_FILE_URI"
        }
      ],
      "generation_config": {
        "transcription_config": {
          "language_codes": []
        }
      }
    }'
  ```

  {% /tab %}

{% /tabs %}

If you know the language in advance, specify BCP-47 language codes in `language_codes` to improve transcription accuracy (see [Supported languages](/docs/transcribe#supported-languages)):

{% tabs %}
  {% tab filename="transcribe_language_hint.py" label="Python" %}
  ```python
  generation_config = {
      "transcription_config": {
          "language_codes": ["es-ES"],
      }
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_language_hint.js" label="JavaScript" %}
  ```javascript
  const generationConfig = {
    transcriptionConfig: {
      languageCodes: ["es-ES"],
    },
  };
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "google.golang.org/genai/interactions/models/interactions"
  )
  
  func main() {
      generationConfig := &interactions.GenerationConfig{
          TranscriptionConfig: &interactions.TranscriptionConfig{
              LanguageCodes: []string{"es-ES"},
          },
      }
      _ = generationConfig
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_language_hint.json" label="REST" %}
  ```json
  {
    "generation_config": {
      "transcription_config": {
        "language_codes": ["es-ES"]
      }
    }
  }
  ```

  {% /tab %}

{% /tabs %}

## Custom vocabulary  {% id="custom-vocabulary" %}

You can steer the speech model toward uncommon words, technical jargon, brand names, or proper nouns. Supply up to 1,000 terms in the `custom_vocabulary` array (best results are typically achieved with up to 100 terms):

{% callout type="note" %}
  You cannot combine `custom_vocabulary` with speaker diarization or word-level timestamps. The API rejects requests that include `custom_vocabulary` with either feature.

{% /callout %}

{% tabs %}
  {% tab filename="transcribe_custom_vocab.py" label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  response = client.interactions.create(
      model="gemini-3.5-transcribe",
      input=[audio_file],
      generation_config={
          "transcription_config": {
              "custom_vocabulary": ["Gemini", "Kubernetes", "BigQuery"],
          }
      },
  )
  ```

  {% /tab %}

  {% tab filename="transcribe_custom_vocab.js" label="JavaScript" %}
  ```javascript
  const response = await ai.interactions.create({
    model: "gemini-3.5-transcribe",
    input: [audioFile],
    generationConfig: {
      transcriptionConfig: {
        customVocabulary: ["Gemini", "Kubernetes", "BigQuery"],
      },
    },
  });
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      audioFile, err := client.Files.UploadFromPath(ctx, "path/to/sample.mp3", nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateModelInteraction{
              Model: interactions.Model("gemini-3.5-transcribe"),
              Input: interactions.NewInteractionsInput([]interactions.Content{
                  interactions.NewContent(interactions.AudioContent{
                      URI:      genai.Ptr(audioFile.URI),
                      MimeType: interactions.AudioContentMimeType(audioFile.MIMEType).ToPointer(),
                  }),
              }),
              GenerationConfig: &interactions.GenerationConfig{
                  TranscriptionConfig: &interactions.TranscriptionConfig{
                      CustomVocabulary: []string{"Gemini", "Kubernetes", "BigQuery"},
                  },
              },
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
  
      fmt.Println(res.Interaction.GetOutputText())
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_custom_vocab.sh" label="REST" %}
  ```bash
  curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "models/gemini-3.5-transcribe",
      "input": [
        {
          "type": "file",
          "file_uri": "YOUR_FILE_URI"
        }
      ],
      "generation_config": {
        "transcription_config": {
          "custom_vocabulary": ["Gemini", "Kubernetes", "BigQuery"]
        }
      }
    }'
  ```

  {% /tab %}

{% /tabs %}

## Speaker diarization  {% id="speaker-diarization" %}

Speaker diarization identifies different voices in the recording and tags each segment with a speaker identifier like `spk_1` or `spk_2`. Up to 8 speakers are supported (attribution for 3 or more speakers is experimental).

Enable diarization by setting `diarization_mode` to `"speaker"` within `mode`:

{% tabs %}
  {% tab filename="transcribe_diarization.py" label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  response = client.interactions.create(
      model="gemini-3.5-transcribe",
      input=[audio_file],
      generation_config={
          "transcription_config": {
              "mode": {
                  "type": "verbatim",
                  "diarization_mode": "speaker",
              }
          }
      },
  )
  ```

  {% /tab %}

  {% tab filename="transcribe_diarization.js" label="JavaScript" %}
  ```javascript
  const response = await ai.interactions.create({
    model: "gemini-3.5-transcribe",
    input: [audioFile],
    generationConfig: {
      transcriptionConfig: {
        mode: {
          type: "verbatim",
          diarizationMode: "speaker",
        },
      },
    },
  });
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      audioFile, err := client.Files.UploadFromPath(ctx, "path/to/sample.mp3", nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateModelInteraction{
              Model: interactions.Model("gemini-3.5-transcribe"),
              Input: interactions.NewInteractionsInput([]interactions.Content{
                  interactions.NewContent(interactions.AudioContent{
                      URI:      genai.Ptr(audioFile.URI),
                      MimeType: interactions.AudioContentMimeType(audioFile.MIMEType).ToPointer(),
                  }),
              }),
              GenerationConfig: &interactions.GenerationConfig{
                  TranscriptionConfig: &interactions.TranscriptionConfig{
                      Mode: genai.Ptr(interactions.NewTranscriptionConfigMode(interactions.NewTranscriptionMode(interactions.VerbatimTranscriptionMode{
                          DiarizationMode: genai.Ptr("speaker"),
                      }))),
                  },
              },
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
  
      fmt.Println(res.Interaction.GetOutputText())
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_diarization.sh" label="REST" %}
  ```bash
  curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "models/gemini-3.5-transcribe",
      "input": [
        {
          "type": "file",
          "file_uri": "YOUR_FILE_URI"
        }
      ],
      "generation_config": {
        "transcription_config": {
          "mode": {
            "type": "verbatim",
            "diarization_mode": "speaker"
          }
        }
      }
    }'
  ```

  {% /tab %}

{% /tabs %}

## Word-level timestamps  {% id="word-timestamps" %}

Word-level timestamps provide exact start and end offsets for every recognized word in the audio stream.

{% callout type="note" %}
  Enabling word-level timestamps may degrade overall transcription accuracy.

{% /callout %}

Enable timestamps by setting `timestamp_granularities` to `["word"]` within `mode`:

{% tabs %}
  {% tab filename="transcribe_timestamps.py" label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  response = client.interactions.create(
      model="gemini-3.5-transcribe",
      input=[audio_file],
      generation_config={
          "transcription_config": {
              "mode": {
                  "type": "verbatim",
                  "timestamp_granularities": ["word"],
              }
          }
      },
  )
  ```

  {% /tab %}

  {% tab filename="transcribe_timestamps.js" label="JavaScript" %}
  ```javascript
  const response = await ai.interactions.create({
    model: "gemini-3.5-transcribe",
    input: [audioFile],
    generationConfig: {
      transcriptionConfig: {
        mode: {
          type: "verbatim",
          timestampGranularities: ["word"],
        },
      },
    },
  });
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      audioFile, err := client.Files.UploadFromPath(ctx, "path/to/sample.mp3", nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateModelInteraction{
              Model: interactions.Model("gemini-3.5-transcribe"),
              Input: interactions.NewInteractionsInput([]interactions.Content{
                  interactions.NewContent(interactions.AudioContent{
                      URI:      genai.Ptr(audioFile.URI),
                      MimeType: interactions.AudioContentMimeType(audioFile.MIMEType).ToPointer(),
                  }),
              }),
              GenerationConfig: &interactions.GenerationConfig{
                  TranscriptionConfig: &interactions.TranscriptionConfig{
                      Mode: genai.Ptr(interactions.NewTranscriptionConfigMode(interactions.NewTranscriptionMode(interactions.VerbatimTranscriptionMode{
                          TimestampGranularities: []string{"word"},
                      }))),
                  },
              },
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
  
      fmt.Println(res.Interaction.GetOutputText())
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_timestamps.sh" label="REST" %}
  ```bash
  curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "models/gemini-3.5-transcribe",
      "input": [
        {
          "type": "file",
          "file_uri": "YOUR_FILE_URI"
        }
      ],
      "generation_config": {
        "transcription_config": {
          "mode": {
            "type": "verbatim",
            "timestamp_granularities": ["word"]
          }
        }
      }
    }'
  ```

  {% /tab %}

{% /tabs %}

You can combine `diarization_mode` and `timestamp_granularities` in a single request to receive both speaker labels and word timestamps:

{% tabs %}
  {% tab filename="transcribe_diarization_timestamps.py" label="Python" %}
  ```python
  generation_config = {
      "transcription_config": {
          "mode": {
              "type": "verbatim",
              "diarization_mode": "speaker",
              "timestamp_granularities": ["word"],
          },
      }
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_diarization_timestamps.js" label="JavaScript" %}
  ```javascript
  const generationConfig = {
    transcriptionConfig: {
      mode: {
        type: "verbatim",
        diarizationMode: "speaker",
        timestampGranularities: ["word"],
      },
    },
  };
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
  )
  
  func main() {
      generationConfig := &interactions.GenerationConfig{
          TranscriptionConfig: &interactions.TranscriptionConfig{
              Mode: genai.Ptr(interactions.NewTranscriptionConfigMode(interactions.NewTranscriptionMode(interactions.VerbatimTranscriptionMode{
                  DiarizationMode:        genai.Ptr("speaker"),
                  TimestampGranularities: []string{"word"},
              }))),
          },
      }
      _ = generationConfig
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_diarization_timestamps.json" label="REST" %}
  ```json
  {
    "generation_config": {
      "transcription_config": {
        "mode": {
          "type": "verbatim",
          "diarization_mode": "speaker",
          "timestamp_granularities": ["word"]
        }
      }
    }
  }
  ```

  {% /tab %}

{% /tabs %}

## Transcription modes  {% id="transcription-modes" %}

Gemini 3.5 Transcribe supports two transcription modes via the `mode` parameter:

*   **`verbatim` (default)**: Returns an exact word-for-word transcript of everything spoken, preserving raw filler words ("um", "uh", "like", "you know"), repetitions, pauses, and false starts. Required when using timestamps or speaker diarization.
*   **`smart` (Smart transcription)**: Optimizes the transcript for reading by applying intelligent post-processing:  *   **Disfluency removal**: Strips conversational filler words, stuttering, and false starts.
  *   **Inline self-corrections**: Resolves spoken corrections directly (for example, *"Let's meet on Tuesday, actually no, Wednesday at two"* becomes *"Let's meet on Wednesday at 2:00 PM"*).
  *   **Automatic structured formatting**: Automatically structures spoken thoughts into paragraphs, numbered lists, bullet points, formatted dates, currencies, and numbers.
  *   **Grammatical cleanup**: Applies natural punctuation, sentence casing, and flow.


{% table %}
  * Spoken audio
  * `verbatim` output
  * `smart` (Smart transcription) output

  ---

  * "Um, so for the meeting, I think we should, uh, invite Alice and, wait no, Bob and Carol."
  * "Um so for the meeting I think we should uh invite Alice and wait no Bob and Carol."
  * "For the meeting, I think we should invite Bob and Carol."

  ---

  * "First item review budget second item finalize timeline third item send recap"
  * "first item review budget second item finalize timeline third item send recap"
  *     1. Review budget
    2. Finalize timeline
    3. Send recap

{% /table %}

{% tabs %}
  {% tab filename="transcribe_smart_mode.py" label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  response = client.interactions.create(
      model="gemini-3.5-transcribe",
      input=[audio_file],
      generation_config={
          "transcription_config": {
              "mode": "smart",
          }
      },
  )
  print(response.output_text)
  ```

  {% /tab %}

  {% tab filename="transcribe_smart_mode.js" label="JavaScript" %}
  ```javascript
  const response = await ai.interactions.create({
    model: "gemini-3.5-transcribe",
    input: [audioFile],
    generationConfig: {
      transcriptionConfig: {
        mode: "smart",
      },
    },
  });
  console.log(response.outputText);
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      audioFile, err := client.Files.UploadFromPath(ctx, "path/to/sample.mp3", nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateModelInteraction{
              Model: interactions.Model("gemini-3.5-transcribe"),
              Input: interactions.NewInteractionsInput([]interactions.Content{
                  interactions.NewContent(interactions.AudioContent{
                      URI:      genai.Ptr(audioFile.URI),
                      MimeType: interactions.AudioContentMimeType(audioFile.MIMEType).ToPointer(),
                  }),
              }),
              GenerationConfig: &interactions.GenerationConfig{
                  TranscriptionConfig: &interactions.TranscriptionConfig{
                      Mode: genai.Ptr(interactions.NewTranscriptionConfigMode(interactions.TranscriptionConfigModeEnumSmart)),
                  },
              },
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
  
      fmt.Println(res.Interaction.GetOutputText())
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_smart_mode.sh" label="REST" %}
  ```bash
  curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "models/gemini-3.5-transcribe",
      "input": [
        {
          "type": "file",
          "file_uri": "YOUR_FILE_URI"
        }
      ],
      "generation_config": {
        "transcription_config": {
          "mode": "smart"
        }
      }
    }'
  ```

  {% /tab %}

{% /tabs %}

{% callout type="note" %}
  Smart transcription (`"smart"`) is incompatible with `timestamp_granularities` and `diarization_mode`. If you need word timestamps or speaker diarization, use verbatim mode (default).

{% /callout %}

## Parsing transcription output  {% id="parsing-output" %}

The complete transcript text is returned in `response.output_text`.

When `timestamp_granularities` or `diarization_mode` is enabled, the API also returns detailed word-level annotations attached to the interaction content.

Here is how to extract and iterate over word timestamps and speaker turns:

{% tabs %}
  {% tab filename="transcribe_parse_output.py" label="Python" %}
  ```python
  def extract_word_annotations(response):
      words = []
      for step in getattr(response, "steps", []) or []:
          for content in getattr(step, "content", []) or []:
              for annotation in getattr(content, "annotations", []) or []:
                  if getattr(annotation, "type", None) == "word_info":
                      words.append(annotation)
      return words
  
  words = extract_word_annotations(response)
  
  for w in words:
      speaker = f"[{w.speaker}] " if getattr(w, "speaker", None) else ""
      start = getattr(w, "start_offset", "")
      end = getattr(w, "end_offset", "")
      timing = f"({start} -> {end}) " if start and end else ""
      print(f"{speaker}{timing}{w.text}")
  ```

  {% /tab %}

  {% tab filename="transcribe_parse_output.js" label="JavaScript" %}
  ```javascript
  function extractWordAnnotations(response) {
    const words = [];
    for (const step of response.steps ?? []) {
      for (const content of step.content ?? []) {
        for (const annotation of content.annotations ?? []) {
          if (annotation.type === "word_info") {
            words.push(annotation);
          }
        }
      }
    }
    return words;
  }
  
  const words = extractWordAnnotations(response);
  
  for (const w of words) {
    const speaker = w.speaker ? `[${w.speaker}] ` : "";
    const timing = (w.start_offset && w.end_offset) ? `(${w.start_offset} -> ${w.end_offset}) ` : "";
    console.log(`${speaker}${timing}${w.text}`);
  }
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "fmt"
  
      "google.golang.org/genai/interactions/models/interactions"
  )
  
  func extractWordAnnotations(interaction *interactions.Interaction) []*interactions.WordInfo {
      var words []*interactions.WordInfo
      if interaction == nil {
          return words
      }
      for _, step := range interaction.Steps {
          if step.ModelOutputStep != nil {
              for _, content := range step.ModelOutputStep.Content {
                  if content.TextContent != nil {
                      for _, annotation := range content.TextContent.Annotations {
                          if annotation.WordInfo != nil {
                              words = append(words, annotation.WordInfo)
                          }
                      }
                  }
              }
          }
      }
      return words
  }
  
  func main() {
      var interaction *interactions.Interaction
      words := extractWordAnnotations(interaction)
  
      for _, w := range words {
          speaker := ""
          if w.Speaker != nil && *w.Speaker != "" {
              speaker = fmt.Sprintf("[%s] ", *w.Speaker)
          }
          timing := ""
          if w.StartOffset != nil && w.EndOffset != nil {
              timing = fmt.Sprintf("(%s -> %s) ", *w.StartOffset, *w.EndOffset)
          }
          fmt.Printf("%s%s%s\n", speaker, timing, w.GetText())
      }
  }
  ```

  {% /tab %}

  {% tab filename="transcribe_parse_output.json" label="REST" %}
  ```json
  {
    "id": "interactions/abc123xyz",
    "status": "completed",
    "steps": [
      {
        "id": "step_001",
        "type": "model_output",
        "content": [
          {
            "type": "text",
            "text": "Hello world",
            "annotations": [
              {
                "type": "word_info",
                "text": "Hello",
                "speaker": "spk_1",
                "start_offset": "0.100s",
                "end_offset": "0.400s"
              },
              {
                "type": "word_info",
                "text": "world",
                "speaker": "spk_1",
                "start_offset": "0.500s",
                "end_offset": "0.800s"
              }
            ]
          }
        ]
      }
    ]
  }
  ```

  {% /tab %}

{% /tabs %}

## Supported languages  {% id="supported-languages" %}

The following languages and BCP-47 language codes are supported for Gemini 3.5 Transcribe:

| Language | BCP-47 Code | Language | BCP-47 Code |
| :--- | :--- | :--- | :--- |
| Afrikaans | `af-ZA` | Japanese | `ja-JP` |
| Amharic | `am-ET` | Javanese | `jv-ID` |
| Arabic (Egypt) | `ar-EG` | Kabuverdianu | `kea-CV` |
| Armenian | `hy-AM` | Kannada | `kn-IN` |
| Assamese | `as-IN` | Kazakh | `kk-KZ` |
| Azerbaijani | `az-AZ` | Korean | `ko-KR` |
| Belarusian | `be-BY` | Kyrgyz | `ky-KG` |
| Bengali (Bangladesh) | `bn-BD` | Latvian | `lv-LV` |
| Bengali (India) | `bn-IN` | Lingala | `ln-CD` |
| Bosnian | `bs-BA` | Lithuanian | `lt-LT` |
| Bulgarian | `bg-BG` | Macedonian | `mk-MK` |
| Bulgarian (Aromanian) | `rup-BG` | Malay | `ms-MY` |
| Burmese | `my-MM` | Malayalam | `ml-IN` |
| Cantonese (Traditional) | `yue-Hant-HK` | Maltese | `mt-MT` |
| Catalan | `ca-ES` | Mandarin Chinese (Simplified) | `cmn-Hans-CN` |
| Cebuano | `ceb` | Marathi | `mr-IN` |
| Central Khmer | `km-KH` | Mongolian | `mn-MN` |
| Croatian | `hr-HR` | Nepali | `ne-NP` |
| Czech | `cs-CZ` | Norwegian | `nb-NO` |
| Danish | `da-DK` | Oriya | `or-IN` |
| Dutch | `nl-NL` | Polish | `pl-PL` |
| English (Great Britain) | `en-GB` | Portuguese (Brazil) | `pt-BR` |
| English (India) | `en-IN` | Portuguese (Portugal) | `pt-PT` |
| English (United States) | `en-US` | Punjabi | `pa-IN` |
| Estonian | `et-EE` | Punjabi (Gurmukhi script) | `pa-Guru-IN` |
| Farsi | `fa-IR` | Romanian | `ro-RO` |
| Filipino | `fil-PH` | Russian | `ru-RU` |
| Finnish | `fi-FI` | Serbian | `sr-RS` |
| French | `fr-FR` | Sindhi (Arabic script) | `sd-Arab-IN` |
| Galician | `gl-ES` | Slovak | `sk-SK` |
| Georgian | `ka-GE` | Slovenian | `sl-SI` |
| German | `de-DE` | Spanish (Latin America) | `es-419` |
| Greek | `el-GR` | Spanish (United States) | `es-US` |
| Gujarati | `gu-IN` | Swahili (Kenya) | `sw-KE` |
| Hausa | `ha-NG` | Swedish | `sv-SE` |
| Hebrew | `he-IL` | Tajik | `tg-TJ` |
| Hindi | `hi-IN` | Telugu | `te-IN` |
| Hungarian | `hu-HU` | Thai | `th-TH` |
| Icelandic | `is-IS` | Turkish | `tr-TR` |
| Indian English | `en-IN` | Ukrainian | `uk-UA` |
| Indonesian | `id-ID` | Uzbek | `uz-UZ` |
| Italian | `it-IT` | Vietnamese | `vi-VN` |

## Supported audio formats  {% id="supported-formats" %}

Gemini 3.5 Transcribe supports the following audio format MIME types:

* WAV - `audio/wav`
* MP3 - `audio/mp3`
* AIFF - `audio/aiff`
* AAC - `audio/aac`
* OGG - `audio/ogg`
* FLAC - `audio/flac`
* MPEG - `audio/mpeg`
* M4A - `audio/m4a`
* L16 - `audio/l16`
* Opus - `audio/opus`
* ALAW - `audio/alaw`
* MULAW - `audio/mulaw`
* WebM - `audio/webm`

For the complete list of supported MIME types and parameter schemas, see the [Interactions API reference](https://ai.google.dev/api/interactions-api#Resource:Content).

## Parameter reference  {% id="parameter-reference" %}

Configure transcription by setting fields within the `transcription_config` object in `generation_config`:

| Field | Type | Description |
| :--- | :--- | :--- |
| `language_codes` | Array of strings | BCP-47 language codes (e.g., `["en-US"]`). If omitted or empty (`[]`), the model automatically detects the language and handles code-switching. |
| `custom_vocabulary` | Array of strings | Up to 1,000 custom terms, acronyms, or proper names to bias speech recognition. Incompatible with speaker diarization and word-level timestamps. |
| `mode` | Object or String | Transcription mode configuration. Accepts `"smart"` or a verbatim mode object (`{"type": "verbatim", ...}`). Defaults to verbatim transcription. |
| `mode.type` | String | *(Verbatim mode only)* Mode identifier. Always set to `"verbatim"`. |
| `mode.timestamp_granularities` | Array of strings | *(Verbatim mode only)* Granularity of timestamps to return. Pass `["word"]` to enable word start and end offsets. Incompatible with custom vocabulary. |
| `mode.diarization_mode` | String | *(Verbatim mode only)* Diarization mode. Pass `"speaker"` to identify and label distinct speakers. Incompatible with custom vocabulary. |

## Best practices  {% id="best-practices" %}

*   **Provide clean audio:** Ensure audio recordings have clear voice separation and avoid severe clipping.
*   **Provide language hints when known:** If you know the audio language in advance, specify `language_codes` to maximize accuracy.
*   **Target custom vocabulary:** Include only distinct domain terms, brand names, or proper nouns in `custom_vocabulary` rather than common everyday words.
*   **Use the Files API for large recordings:** For files longer than a few seconds, upload the file using `client.files.upload` and pass the returned file URI to the model.

## Limitations  {% id="limitations" %}

*   **Audio duration:** Standard unary requests support audio files up to 1 hour. Audio processing is limited to 30 minutes when features like speaker diarization or word-level timestamps are enabled.
*   **Word-level timestamps:** Enabling word-level timestamps may degrade overall transcription accuracy.
*   **Speaker diarization:** Speaker diarization supports up to 8 speakers. Speaker attribution for 3 or more speakers is experimental.
*   **Custom vocabulary:** You can provide up to 1,000 terms in `custom_vocabulary`, but best results are typically achieved with up to 100 terms. You cannot combine `custom_vocabulary` with speaker diarization or word-level timestamps; the API rejects requests that specify `custom_vocabulary` alongside either feature.
*   **Mode compatibility:** Smart transcription (`"smart"`) cannot be combined with `timestamp_granularities` or `diarization_mode`.

## What's next  {% id="whats-next" %}

*   Stream real-time audio with the [Live transcription guide](/docs/live-api/live-transcribe) using the Live API.
*   Explore [Audio understanding](/docs/audio) to analyze, summarize, or query audio content.
*   Learn how to synthesize audio from text using [Text-to-speech](/docs/speech-generation).
*   Check the [Pricing page](/docs/pricing#gemini-3.5-transcribe) for model pricing and token limits.
*   Check the [Files API](/docs/files) guide for details on uploading and managing media files.

