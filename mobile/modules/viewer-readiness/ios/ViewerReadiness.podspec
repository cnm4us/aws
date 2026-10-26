Pod::Spec.new do |s|
  s.name = 'ViewerReadiness'
  s.version = '0.1.0'
  s.summary = 'Internal feed preparation feasibility evidence'
  s.description = 'Attempt-scoped native seek and decoded-frame evidence for the viewer readiness check.'
  s.license = { :type => 'MIT' }
  s.author = 'BAWebTech'
  s.homepage = 'https://aws.bawebtech.com'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CoreVideo', 'UIKit'
  s.swift_version = '5.9'
  s.source_files = '**/*.swift'
end
