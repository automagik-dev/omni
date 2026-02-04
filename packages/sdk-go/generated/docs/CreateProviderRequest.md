# CreateProviderRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** | Provider name | 
**Schema** | Pointer to **string** | Schema type | [optional] [default to "agnoos"]
**BaseUrl** | **string** | Base URL | 
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

### NewCreateProviderRequest

`func NewCreateProviderRequest(name string, baseUrl string, ) *CreateProviderRequest`

NewCreateProviderRequest instantiates a new CreateProviderRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCreateProviderRequestWithDefaults

`func NewCreateProviderRequestWithDefaults() *CreateProviderRequest`

NewCreateProviderRequestWithDefaults instantiates a new CreateProviderRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *CreateProviderRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *CreateProviderRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *CreateProviderRequest) SetName(v string)`

SetName sets Name field to given value.


### GetSchema

`func (o *CreateProviderRequest) GetSchema() string`

GetSchema returns the Schema field if non-nil, zero value otherwise.

### GetSchemaOk

`func (o *CreateProviderRequest) GetSchemaOk() (*string, bool)`

GetSchemaOk returns a tuple with the Schema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSchema

`func (o *CreateProviderRequest) SetSchema(v string)`

SetSchema sets Schema field to given value.

### HasSchema

`func (o *CreateProviderRequest) HasSchema() bool`

HasSchema returns a boolean if a field has been set.

### GetBaseUrl

`func (o *CreateProviderRequest) GetBaseUrl() string`

GetBaseUrl returns the BaseUrl field if non-nil, zero value otherwise.

### GetBaseUrlOk

`func (o *CreateProviderRequest) GetBaseUrlOk() (*string, bool)`

GetBaseUrlOk returns a tuple with the BaseUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBaseUrl

`func (o *CreateProviderRequest) SetBaseUrl(v string)`

SetBaseUrl sets BaseUrl field to given value.


### GetApiKey

`func (o *CreateProviderRequest) GetApiKey() string`

GetApiKey returns the ApiKey field if non-nil, zero value otherwise.

### GetApiKeyOk

`func (o *CreateProviderRequest) GetApiKeyOk() (*string, bool)`

GetApiKeyOk returns a tuple with the ApiKey field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetApiKey

`func (o *CreateProviderRequest) SetApiKey(v string)`

SetApiKey sets ApiKey field to given value.

### HasApiKey

`func (o *CreateProviderRequest) HasApiKey() bool`

HasApiKey returns a boolean if a field has been set.

### GetSchemaConfig

`func (o *CreateProviderRequest) GetSchemaConfig() map[string]interface{}`

GetSchemaConfig returns the SchemaConfig field if non-nil, zero value otherwise.

### GetSchemaConfigOk

`func (o *CreateProviderRequest) GetSchemaConfigOk() (*map[string]interface{}, bool)`

GetSchemaConfigOk returns a tuple with the SchemaConfig field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSchemaConfig

`func (o *CreateProviderRequest) SetSchemaConfig(v map[string]interface{})`

SetSchemaConfig sets SchemaConfig field to given value.

### HasSchemaConfig

`func (o *CreateProviderRequest) HasSchemaConfig() bool`

HasSchemaConfig returns a boolean if a field has been set.

### GetDefaultStream

`func (o *CreateProviderRequest) GetDefaultStream() bool`

GetDefaultStream returns the DefaultStream field if non-nil, zero value otherwise.

### GetDefaultStreamOk

`func (o *CreateProviderRequest) GetDefaultStreamOk() (*bool, bool)`

GetDefaultStreamOk returns a tuple with the DefaultStream field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefaultStream

`func (o *CreateProviderRequest) SetDefaultStream(v bool)`

SetDefaultStream sets DefaultStream field to given value.

### HasDefaultStream

`func (o *CreateProviderRequest) HasDefaultStream() bool`

HasDefaultStream returns a boolean if a field has been set.

### GetDefaultTimeout

`func (o *CreateProviderRequest) GetDefaultTimeout() int32`

GetDefaultTimeout returns the DefaultTimeout field if non-nil, zero value otherwise.

### GetDefaultTimeoutOk

`func (o *CreateProviderRequest) GetDefaultTimeoutOk() (*int32, bool)`

GetDefaultTimeoutOk returns a tuple with the DefaultTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefaultTimeout

`func (o *CreateProviderRequest) SetDefaultTimeout(v int32)`

SetDefaultTimeout sets DefaultTimeout field to given value.

### HasDefaultTimeout

`func (o *CreateProviderRequest) HasDefaultTimeout() bool`

HasDefaultTimeout returns a boolean if a field has been set.

### GetSupportsStreaming

`func (o *CreateProviderRequest) GetSupportsStreaming() bool`

GetSupportsStreaming returns the SupportsStreaming field if non-nil, zero value otherwise.

### GetSupportsStreamingOk

`func (o *CreateProviderRequest) GetSupportsStreamingOk() (*bool, bool)`

GetSupportsStreamingOk returns a tuple with the SupportsStreaming field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsStreaming

`func (o *CreateProviderRequest) SetSupportsStreaming(v bool)`

SetSupportsStreaming sets SupportsStreaming field to given value.

### HasSupportsStreaming

`func (o *CreateProviderRequest) HasSupportsStreaming() bool`

HasSupportsStreaming returns a boolean if a field has been set.

### GetSupportsImages

`func (o *CreateProviderRequest) GetSupportsImages() bool`

GetSupportsImages returns the SupportsImages field if non-nil, zero value otherwise.

### GetSupportsImagesOk

`func (o *CreateProviderRequest) GetSupportsImagesOk() (*bool, bool)`

GetSupportsImagesOk returns a tuple with the SupportsImages field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsImages

`func (o *CreateProviderRequest) SetSupportsImages(v bool)`

SetSupportsImages sets SupportsImages field to given value.

### HasSupportsImages

`func (o *CreateProviderRequest) HasSupportsImages() bool`

HasSupportsImages returns a boolean if a field has been set.

### GetSupportsAudio

`func (o *CreateProviderRequest) GetSupportsAudio() bool`

GetSupportsAudio returns the SupportsAudio field if non-nil, zero value otherwise.

### GetSupportsAudioOk

`func (o *CreateProviderRequest) GetSupportsAudioOk() (*bool, bool)`

GetSupportsAudioOk returns a tuple with the SupportsAudio field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsAudio

`func (o *CreateProviderRequest) SetSupportsAudio(v bool)`

SetSupportsAudio sets SupportsAudio field to given value.

### HasSupportsAudio

`func (o *CreateProviderRequest) HasSupportsAudio() bool`

HasSupportsAudio returns a boolean if a field has been set.

### GetSupportsDocuments

`func (o *CreateProviderRequest) GetSupportsDocuments() bool`

GetSupportsDocuments returns the SupportsDocuments field if non-nil, zero value otherwise.

### GetSupportsDocumentsOk

`func (o *CreateProviderRequest) GetSupportsDocumentsOk() (*bool, bool)`

GetSupportsDocumentsOk returns a tuple with the SupportsDocuments field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsDocuments

`func (o *CreateProviderRequest) SetSupportsDocuments(v bool)`

SetSupportsDocuments sets SupportsDocuments field to given value.

### HasSupportsDocuments

`func (o *CreateProviderRequest) HasSupportsDocuments() bool`

HasSupportsDocuments returns a boolean if a field has been set.

### GetDescription

`func (o *CreateProviderRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *CreateProviderRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *CreateProviderRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *CreateProviderRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetTags

`func (o *CreateProviderRequest) GetTags() []string`

GetTags returns the Tags field if non-nil, zero value otherwise.

### GetTagsOk

`func (o *CreateProviderRequest) GetTagsOk() (*[]string, bool)`

GetTagsOk returns a tuple with the Tags field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTags

`func (o *CreateProviderRequest) SetTags(v []string)`

SetTags sets Tags field to given value.

### HasTags

`func (o *CreateProviderRequest) HasTags() bool`

HasTags returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


