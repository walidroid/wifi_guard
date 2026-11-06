{
  "targets": [
    {
      "target_name": "wlan_native",
      "sources": [
        "native/wlan_native.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "UNICODE",
        "_UNICODE",
        "_WIN32_WINNT=0x0A00",
        "WIN32_LEAN_AND_MEAN"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "-lwlanapi.lib",
              "-lole32.lib",
              "-loleaut32.lib",
              "-ladvapi32.lib",
              "-lshell32.lib",
              "-luserenv.lib",
              "-lcfgmgr32.lib",
              "-lsetupapi.lib",
              "-liphlpapi.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": [
                  "/std:c++17",
                  "/utf-8"
                ]
              }
            }
          }
        ]
      ]
    }
  ]
}
