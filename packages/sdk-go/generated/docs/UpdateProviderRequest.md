# UpdateProviderRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | Pointer to **string** | Provider name | [optional] 
**Schema** | Pointer to **string** | Schema type | [optional] [default to "agnoos"]
**BaseUrl** | Pointer to **string** | Base URL | [optional] 
**ApiKey** | Pointer to **string** | API key (encrypted) | [optional] 
**SchemaConfig** | Pointer to **map[string]interface{}** | Schema config | [optional] 
**DefaultStream** | Pointer to **bool** | Default streaming | [optional] [default to true]
**DefaultTimeout** | Pointer to **int32** | Default timeout | [optional] [default to 60]
**SupportsStreaming** | Pointer to **bool** | Supports streaming | [optional] [default to true]
**SupportsImages** | Pointer to **bool** | Supports images | [optional] [default to false]
**SupportsAudio** | Pointer to **bool** | Supports audio | [optional] [default to false]
**SupportsDocuments** | Pointer to **bool** | Supports documents | [optional] [default to false]
**Description** | Pointer to **string** | Description | [optional] 
**Tags** | Pointer to **[]string** | Tags | [optional] 

## Methods

### NewUpdateProviderRequest

`func NewUpdateProviderRequest() *UpdateProviderRequest`

NewUpdateProviderRequest instantiates a new UpdateProviderRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUpdateProviderRequestWithDefaults

`func NewUpdateProviderRequestWithDefaults() *UpdateProviderRequest`

NewUpdateProviderRequestWithDefaults instantiates a new UpdateProviderRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *UpdateProviderRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *UpdateProviderRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *UpdateProviderRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *UpdateProviderRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetSchema

`func (o *UpdateProviderRequest) GetSchema() string`

GetSchema returns the Schema field if non-nil, zero value otherwise.

### GetSchemaOk

`func (o *UpdateProviderRequest) GetSchemaOk() (*string, bool)`

GetSchemaOk returns a tuple with the Schema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSchema

`func (o *UpdateProviderRequest) SetSchema(v string)`

SetSchema sets Schema field to given value.

### HasSchema

`func (o *UpdateProviderRequest) HasSchema() bool`

HasSchema returns a boolean if a field has been set.

### GetBaseUrl

`func (o *UpdateProviderRequest) GetBaseUrl() string`

GetBaseUrl returns the BaseUrl field if non-nil, zero value otherwise.

### GetBaseUrlOk

`func (o *UpdateProviderRequest) GetBaseUrlOk() (*string, bool)`

GetBaseUrlOk returns a tuple with the BaseUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBaseUrl

`func (o *UpdateProviderRequest) SetBaseUrl(v string)`

SetBaseUrl sets BaseUrl field to given value.

### HasBaseUrl

`func (o *UpdateProviderRequest) HasBaseUrl() bool`

HasBaseUrl returns a boolean if a field has been set.

### GetApiKey

`func (o *UpdateProviderRequest) GetApiKey() string`

GetApiKey returns the ApiKey field if non-nil, zero value otherwise.

### GetApiKeyOk

`func (o *UpdateProviderRequest) GetApiKeyOk() (*string, bool)`

GetApiKeyOk returns a tuple with the ApiKey field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetApiKey

`func (o *UpdateProviderRequest) SetApiKey(v string)`

SetApiKey sets ApiKey field to given value.

### HasApiKey

`func (o *UpdateProviderRequest) HasApiKey() bool`

HasApiKey returns a boolean if a field has been set.

### GetSchemaConfig

`func (o *UpdateProviderRequest) GetSchemaConfig() map[string]interface{}`

GetSchemaConfig returns the SchemaConfig field if non-nil, zero value otherwise.

### GetSchemaConfigOk

`func (o *UpdateProviderRequest) GetSchemaConfigOk() (*map[string]interface{}, bool)`

GetSchemaConfigOk returns a tuple with the SchemaConfig field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSchemaConfig

`func (o *UpdateProviderRequest) SetSchemaConfig(v map[string]interface{})`

SetSchemaConfig sets SchemaConfig field to given value.

### HasSchemaConfig

`func (o *UpdateProviderRequest) HasSchemaConfig() bool`

HasSchemaConfig returns a boolean if a field has been set.

### GetDefaultStream

`func (o *UpdateProviderRequest) GetDefaultStream() bool`

GetDefaultStream returns the DefaultStream field if non-nil, zero value otherwise.

### GetDefaultStreamOk

`func (o *UpdateProviderRequest) GetDefaultStreamOk() (*bool, bool)`

GetDefaultStreamOk returns a tuple with the DefaultStream field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefaultStream

`func (o *UpdateProviderRequest) SetDefaultStream(v bool)`

SetDefaultStream sets DefaultStream field to given value.

### HasDefaultStream

`func (o *UpdateProviderRequest) HasDefaultStream() bool`

HasDefaultStream returns a boolean if a field has been set.

### GetDefaultTimeout

`func (o *UpdateProviderRequest) GetDefaultTimeout() int32`

GetDefaultTimeout returns the DefaultTimeout field if non-nil, zero value otherwise.

### GetDefaultTimeoutOk

`func (o *UpdateProviderRequest) GetDefaultTimeoutOk() (*int32, bool)`

GetDefaultTimeoutOk returns a tuple with the DefaultTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefaultTimeout

`func (o *UpdateProviderRequest) SetDefaultTimeout(v int32)`

SetDefaultTimeout sets DefaultTimeout field to given value.

### HasDefaultTimeout

`func (o *UpdateProviderRequest) HasDefaultTimeout() bool`

HasDefaultTimeout returns a boolean if a field has been set.

### GetSupportsStreaming

`func (o *UpdateProviderRequest) GetSupportsStreaming() bool`

GetSupportsStreaming returns the SupportsStreaming field if non-nil, zero value otherwise.

### GetSupportsStreamingOk

`func (o *UpdateProviderRequest) GetSupportsStreamingOk() (*bool, bool)`

GetSupportsStreamingOk returns a tuple with the SupportsStreaming field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsStreaming

`func (o *UpdateProviderRequest) SetSupportsStreaming(v bool)`

SetSupportsStreaming sets SupportsStreaming field to given value.

### HasSupportsStreaming

`func (o *UpdateProviderRequest) HasSupportsStreaming() bool`

HasSupportsStreaming returns a boolean if a field has been set.

### GetSupportsImages

`func (o *UpdateProviderRequest) GetSupportsImages() bool`

GetSupportsImages returns the SupportsImages field if non-nil, zero value otherwise.

### GetSupportsImagesOk

`func (o *UpdateProviderRequest) GetSupportsImagesOk() (*bool, bool)`

GetSupportsImagesOk returns a tuple with the SupportsImages field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsImages

`func (o *UpdateProviderRequest) SetSupportsImages(v bool)`

SetSupportsImages sets SupportsImages field to given value.

### HasSupportsImages

`func (o *UpdateProviderRequest) HasSupportsImages() bool`

HasSupportsImages returns a boolean if a field has been set.

### GetSupportsAudio

`func (o *UpdateProviderRequest) GetSupportsAudio() bool`

GetSupportsAudio returns the SupportsAudio field if non-nil, zero value otherwise.

### GetSupportsAudioOk

`func (o *UpdateProviderRequest) GetSupportsAudioOk() (*bool, bool)`

GetSupportsAudioOk returns a tuple with the SupportsAudio field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsAudio

`func (o *UpdateProviderRequest) SetSupportsAudio(v bool)`

SetSupportsAudio sets SupportsAudio field to given value.

### HasSupportsAudio

`func (o *UpdateProviderRequest) HasSupportsAudio() bool`

HasSupportsAudio returns a boolean if a field has been set.

### GetSupportsDocuments

`func (o *UpdateProviderRequest) GetSupportsDocuments() bool`

GetSupportsDocuments returns the SupportsDocuments field if non-nil, zero value otherwise.

### GetSupportsDocumentsOk

`func (o *UpdateProviderRequest) GetSupportsDocumentsOk() (*bool, bool)`

GetSupportsDocumentsOk returns a tuple with the SupportsDocuments field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsDocuments

`func (o *UpdateProviderRequest) SetSupportsDocuments(v bool)`

SetSupportsDocuments sets SupportsDocuments field to given value.

### HasSupportsDocuments

`func (o *UpdateProviderRequest) HasSupportsDocuments() bool`

HasSupportsDocuments returns a boolean if a field has been set.

### GetDescription

`func (o *UpdateProviderRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *UpdateProviderRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *UpdateProviderRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *UpdateProviderRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetTags

`func (o *UpdateProviderRequest) GetTags() []string`

GetTags returns the Tags field if non-nil, zero value otherwise.

### GetTagsOk

`func (o *UpdateProviderRequest) GetTagsOk() (*[]string, bool)`

GetTagsOk returns a tuple with the Tags field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTags

`func (o *UpdateProviderRequest) SetTags(v []string)`

SetTags sets Tags field to given value.

### HasTags

`func (o *UpdateProviderRequest) HasTags() bool`

HasTags returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


