(function () {
  "use strict";
  const CreatePackage = require("./CreatePackage");
  const NwBuilder = require("nw-builder");
  const path = require("path");
  const PreActions = require("./PreActions");

  /**
   * Class for running NwPackager instances
   */
  class NwPackager {
    /**
     * Creates a new NwPackager instance
     * @param {Object} buildOptions The NwBuilder options to use.
     * @param {Object} userPackageOptions The packaging options to use.
     */
    constructor(buildOptions = {}, userPackageOptions = {}) {
      // Set the default package options
      const packageOptions = {
        // %p% is a special symbol that gets replaced with the os name and architecture
        "package_name": "%a%-%v%-%p%",
        "build_current_os_only": false,
        "linux": {
          "pre": {
            "desktop_file": true,
          },
          "packages": {
            "deb": true,
            "rpm": false,
            "tar": false,
            "tar.gz": true,
            "zip": false,
          },
        },
        "osx": {
          "packages": {
            "pkg": true,
            "tar": false,
            "tar.gz": false,
            "zip": true,
          },
        },
        "win": {
          "packages": {
            "inno_setup": false,
            "tar": false,
            "tar.gz": false,
            "zip": true,
          },
        },
      };
      // Combine default and user package options
      Object.assign(packageOptions, userPackageOptions);
      this.packageOptions = packageOptions;

      /*
       * Set additional default nw-builder options
       */

      // nwjs-packager specific cache directory
      if (!buildOptions.cache) {
        buildOptions.cacheDir = `${require('os').homedir()}/.nwjs-packager/cache`;
      }

      // Take all files in current directory by default
      if (!buildOptions.files) {
        buildOptions.files = [
          path.join(process.cwd(), "**"),
          `!${buildOptions.buildDir ? buildOptions.buildDir : path.join(process.cwd(), "build", "**")}`,
          `!${buildOptions.cacheDir ? buildOptions.cacheDir : path.join(process.cwd(), "cache", "**")}`,
        ];
        buildOptions.files.forEach(function (file, i) {
          buildOptions.files[i] = path.normalize(file);
        });
      }

      // Build current OS x32 and x64 variants by default
      if (!buildOptions.platforms || buildOptions.platforms[0] === "" || packageOptions.build_current_os_only) {
        buildOptions.platforms = NwPackager.getCurSuitablePlatforms();
      }

      // Set buildType to "default" regardless of user preference as nwjs-packager controls the package name
      buildOptions.buildType = "default";

      // Separate the version-flavor string into 2 options
      if (buildOptions.version && buildOptions.version.includes("-")) {
        const splitVersion = buildOptions.version.split("-");
        buildOptions.version = splitVersion[0];
        buildOptions.flavor = splitVersion[1];
      }

      this.NwBuilder = new NwBuilder(buildOptions);
      this.NwBuilder.on("log", console.log);
    }

    /**
     * Run the application with nw-builder (without building/packaging).
     */
    run() {
      this.NwBuilder.run().then(function () {
        console.log("Finished running app");
      }).catch(function (error) {
        console.error(error);
      });
    }

    /**
     * Builds an application with nw-builder
     * @return {Promise}
     */
    build() {
      const self = this;
      return new Promise((resolve, reject) => {
        // Build app using nw-builder
        console.log("Building app with nw-builder...");
        self.NwBuilder.build().then(() => {
          resolve();
        }).catch((error) => {
          reject(error);
        });
      });
    }

    /**
     * Packages an application.
     * @return {Promise}
     */
    package() {
      const self = this;
      return new Promise((resolve, reject) => {
        console.log("Packaging app...");
        // The list of promises to resolve
        const promisesList = [];

        // Loop through each platform
        self.NwBuilder.options.platforms.forEach(function (platform) {
          // Get os from platform name
          const curOs = platform.replace(/[0-9]/g, "");
          // The folder containing the build
          const inputDir = path.join(self.NwBuilder.options.buildDir, self.NwBuilder.options.appName, platform);

          // *** Add each pre-packaging action promise ***

          // OS options (eg "win")
          if (curOs in self.packageOptions && "pre" in self.packageOptions[curOs]) {
            for (const [preType, isEnabled] of Object.entries(self.packageOptions[curOs].pre)) {
              if (isEnabled) {
                promisesList.push(PreActions.run(preType, inputDir, self));
              }
            }
          }

          // OS architecture options (eg "win64")
          if (platform in self.packageOptions && "pre" in self.packageOptions[platform]) {
            for (const [preType, isEnabled] of Object.entries(self.packageOptions[platform].pre)) {
              if (isEnabled) {
                promisesList.push(PreActions.run(preType, inputDir, self));
              }
            }
          }

          // *** Add each packaging promise ***

          // The folder to output the package to
          const outputDir = self.NwBuilder.options.buildDir;

          // OS options (eg "win")
          if (curOs in self.packageOptions && "packages" in self.packageOptions[curOs]) {
            for (const [packageType, isEnabled] of Object.entries(self.packageOptions[curOs].packages)) {
              if (isEnabled) {
                promisesList.push(CreatePackage.make(packageType, inputDir, outputDir, platform, self));
              }
            }
          }

          // OS architecture options (eg "win64")
          if (platform in self.packageOptions && "packages" in self.packageOptions[platform]) {
            for (const [packageType, isEnabled] of Object.entries(self.packageOptions[platform].packages)) {
              if (isEnabled) {
                promisesList.push(CreatePackage.make(packageType, inputDir, outputDir, platform, self, false));
              }
            }
          }
        });

        // *** Resolve all of the promises ***
        Promise.all(promisesList).then(function () {
          resolve();
        }).catch(function (error) {
          reject(error);
        });
      });
    }

    /**
     * Converts templates from package_name to output string..
     * @param {String} platform The name of the current platform.
     * @return {String} The converted package name string.
     */
    renderPackageTemplates(platform) {
      let output = this.packageOptions.package_name;
      output = output.replace("%a%", this.NwBuilder.options.appName);
      output = output.replace("%v%", this.NwBuilder.options.appVersion);
      output = output.replace("%p%", platform);
      return output;
    }

    /**
     * Returns an array of NW.js platforms suitable for the current OS
     * @return {Array} The list of suitable platforms (eg ["win32","win64"])
     */
    static getCurSuitablePlatforms() {
      switch (process.platform) {
        case "darwin":
          return ["osx64"];
        case "linux":
          return ["linux32", "linux64"];
        case "win32":
          return ["win32", "win64"];
        default:
          console.log("Error: platform not supported by NW.js.");
          return [];
      }
    }
  }
  module.exports = NwPackager;
})();
