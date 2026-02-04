# Provider

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Provider UUID | 
**Name** | **string** | Provider name | 
**Schema** | **string** | Provider schema type | 
**BaseUrl** | **string** | Base URL | 
**ApiKey** | **NullableString** | API key (masked) | 
**SchemaConfig** | **map[string]interface{}** | Schema config | 
**DefaultStream** | **bool** | Default streaming | 
**DefaultTimeout** | **int32** | Default timeout (seconds) | 
**SupportsStreaming** | **bool** | Supports streaming | 
**SupportsImages** | **bool** | Supports images | 
**SupportsAudio** | **bool** | Supports audio | 
**SupportsDocuments** | **bool** | Supports documents | 
**Description** | **NullableString** | Description | 
**Tags** | **[]string** | Tags | 
**IsActive** | **bool** | Whether active | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewProvider

`func NewProvider(id string, name string, schema string, baseUrl string, apiKey NullableString, schemaConfig map[string]interface{}, defaultStream bool, defaultTimeout int32, supportsStreaming bool, supportsImages bool, supportsAudio bool, supportsDocuments bool, description NullableString, tags []string, isActive bool, createdAt time.Time, updatedAt time.Time, ) *Provider`

NewProvider instantiates a new Provider object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewProviderWithDefaults

`func NewProviderWithDefaults() *Provider`

NewProviderWithDefaults instantiates a new Provider object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *Provider) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *Provider) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *Provider) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *Provider) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *Provider) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *Provider) SetName(v string)`

SetName sets Name field to given value.


### GetSchema

`func (o *Provider) GetSchema() string`

GetSchema returns the Schema field if non-nil, zero value otherwise.

### GetSchemaOk

`func (o *Provider) GetSchemaOk() (*string, bool)`

GetSchemaOk returns a tuple with the Schema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSchema

`func (o *Provider) SetSchema(v string)`

SetSchema sets Schema field to given value.


### GetBaseUrl

`func (o *Provider) GetBaseUrl() string`

GetBaseUrl returns the BaseUrl field if non-nil, zero value otherwise.

### GetBaseUrlOk

`func (o *Provider) GetBaseUrlOk() (*string, bool)`

GetBaseUrlOk returns a tuple with the BaseUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBaseUrl

`func (o *Provider) SetBaseUrl(v string)`

SetBaseUrl sets BaseUrl field to given value.


### GetApiKey

`func (o *Provider) GetApiKey() string`

GetApiKey returns the ApiKey field if non-nil, zero value otherwise.

### GetApiKeyOk

`func (o *Provider) GetApiKeyOk() (*string, bool)`

GetApiKeyOk returns a tuple with the ApiKey field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetApiKey

`func (o *Provider) SetApiKey(v string)`

SetApiKey sets ApiKey field to given value.


### SetApiKeyNil

`func (o *Provider) SetApiKeyNil(b bool)`

 SetApiKeyNil sets the value for ApiKey to be an explicit nil

### UnsetApiKey
`func (o *Provider) UnsetApiKey()`

UnsetApiKey ensures that no value is present for ApiKey, not even an explicit nil
### GetSchemaConfig

`func (o *Provider) GetSchemaConfig() map[string]interface{}`

GetSchemaConfig returns the SchemaConfig field if non-nil, zero value otherwise.

### GetSchemaConfigOk

`func (o *Provider) GetSchemaConfigOk() (*map[string]interface{}, bool)`

GetSchemaConfigOk returns a tuple with the SchemaConfig field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSchemaConfig

`func (o *Provider) SetSchemaConfig(v map[string]interface{})`

SetSchemaConfig sets SchemaConfig field to given value.


### SetSchemaConfigNil

`func (o *Provider) SetSchemaConfigNil(b bool)`

 SetSchemaConfigNil sets the value for SchemaConfig to be an explicit nil

### UnsetSchemaConfig
`func (o *Provider) UnsetSchemaConfig()`

UnsetSchemaConfig ensures that no value is present for SchemaConfig, not even an explicit nil
### GetDefaultStream

`func (o *Provider) GetDefaultStream() bool`

GetDefaultStream returns the DefaultStream field if non-nil, zero value otherwise.

### GetDefaultStreamOk

`func (o *Provider) GetDefaultStreamOk() (*bool, bool)`

GetDefaultStreamOk returns a tuple with the DefaultStream field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefaultStream

`func (o *Provider) SetDefaultStream(v bool)`

SetDefaultStream sets DefaultStream field to given value.


### GetDefaultTimeout

`func (o *Provider) GetDefaultTimeout() int32`

GetDefaultTimeout returns the DefaultTimeout field if non-nil, zero value otherwise.

### GetDefaultTimeoutOk

`func (o *Provider) GetDefaultTimeoutOk() (*int32, bool)`

GetDefaultTimeoutOk returns a tuple with the DefaultTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefaultTimeout

`func (o *Provider) SetDefaultTimeout(v int32)`

SetDefaultTimeout sets DefaultTimeout field to given value.


### GetSupportsStreaming

`func (o *Provider) GetSupportsStreaming() bool`

GetSupportsStreaming returns the SupportsStreaming field if non-nil, zero value otherwise.

### GetSupportsStreamingOk

`func (o *Provider) GetSupportsStreamingOk() (*bool, bool)`

GetSupportsStreamingOk returns a tuple with the SupportsStreaming field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsStreaming

`func (o *Provider) SetSupportsStreaming(v bool)`

SetSupportsStreaming sets SupportsStreaming field to given value.


### GetSupportsImages

`func (o *Provider) GetSupportsImages() bool`

GetSupportsImages returns the SupportsImages field if non-nil, zero value otherwise.

### GetSupportsImagesOk

`func (o *Provider) GetSupportsImagesOk() (*bool, bool)`

GetSupportsImagesOk returns a tuple with the SupportsImages field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsImages

`func (o *Provider) SetSupportsImages(v bool)`

SetSupportsImages sets SupportsImages field to given value.


### GetSupportsAudio

`func (o *Provider) GetSupportsAudio() bool`

GetSupportsAudio returns the SupportsAudio field if non-nil, zero value otherwise.

### GetSupportsAudioOk

`func (o *Provider) GetSupportsAudioOk() (*bool, bool)`

GetSupportsAudioOk returns a tuple with the SupportsAudio field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsAudio

`func (o *Provider) SetSupportsAudio(v bool)`

SetSupportsAudio sets SupportsAudio field to given value.


### GetSupportsDocuments

`func (o *Provider) GetSupportsDocuments() bool`

GetSupportsDocuments returns the SupportsDocuments field if non-nil, zero value otherwise.

### GetSupportsDocumentsOk

`func (o *Provider) GetSupportsDocumentsOk() (*bool, bool)`

GetSupportsDocumentsOk returns a tuple with the SupportsDocuments field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportsDocuments

`func (o *Provider) SetSupportsDocuments(v bool)`

SetSupportsDocuments sets SupportsDocuments field to given value.


### GetDescription

`func (o *Provider) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *Provider) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *Provider) SetDescription(v string)`

SetDescription sets Description field to given value.


### SetDescriptionNil

`func (o *Provider) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *Provider) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetTags

`func (o *Provider) GetTags() []string`

GetTags returns the Tags field if non-nil, zero value otherwise.

### GetTagsOk

`func (o *Provider) GetTagsOk() (*[]string, bool)`

GetTagsOk returns a tuple with the Tags field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTags

`func (o *Provider) SetTags(v []string)`

SetTags sets Tags field to given value.


### SetTagsNil

`func (o *Provider) SetTagsNil(b bool)`

 SetTagsNil sets the value for Tags to be an explicit nil

### UnsetTags
`func (o *Provider) UnsetTags()`

UnsetTags ensures that no value is present for Tags, not even an explicit nil
### GetIsActive

`func (o *Provider) GetIsActive() bool`

GetIsActive returns the IsActive field if non-nil, zero value otherwise.

### GetIsActiveOk

`func (o *Provider) GetIsActiveOk() (*bool, bool)`

GetIsActiveOk returns a tuple with the IsActive field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsActive

`func (o *Provider) SetIsActive(v bool)`

SetIsActive sets IsActive field to given value.


### GetCreatedAt

`func (o *Provider) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *Provider) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *Provider) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *Provider) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *Provider) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *Provider) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


