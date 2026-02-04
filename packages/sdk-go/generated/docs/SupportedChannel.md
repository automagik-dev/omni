# SupportedChannel

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Channel type ID | 
**Name** | **string** | Human-readable channel name | 
**Version** | Pointer to **string** | Plugin version | [optional] 
**Description** | Pointer to **string** | Channel description | [optional] 
**Loaded** | **bool** | Whether plugin is loaded | 
**Capabilities** | Pointer to **map[string]interface{}** | Plugin capabilities | [optional] 

## Methods

### NewSupportedChannel

`func NewSupportedChannel(id string, name string, loaded bool, ) *SupportedChannel`

NewSupportedChannel instantiates a new SupportedChannel object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSupportedChannelWithDefaults

`func NewSupportedChannelWithDefaults() *SupportedChannel`

NewSupportedChannelWithDefaults instantiates a new SupportedChannel object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *SupportedChannel) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *SupportedChannel) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *SupportedChannel) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *SupportedChannel) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *SupportedChannel) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *SupportedChannel) SetName(v string)`

SetName sets Name field to given value.


### GetVersion

`func (o *SupportedChannel) GetVersion() string`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *SupportedChannel) GetVersionOk() (*string, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *SupportedChannel) SetVersion(v string)`

SetVersion sets Version field to given value.

### HasVersion

`func (o *SupportedChannel) HasVersion() bool`

HasVersion returns a boolean if a field has been set.

### GetDescription

`func (o *SupportedChannel) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *SupportedChannel) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *SupportedChannel) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *SupportedChannel) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetLoaded

`func (o *SupportedChannel) GetLoaded() bool`

GetLoaded returns the Loaded field if non-nil, zero value otherwise.

### GetLoadedOk

`func (o *SupportedChannel) GetLoadedOk() (*bool, bool)`

GetLoadedOk returns a tuple with the Loaded field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLoaded

`func (o *SupportedChannel) SetLoaded(v bool)`

SetLoaded sets Loaded field to given value.


### GetCapabilities

`func (o *SupportedChannel) GetCapabilities() map[string]interface{}`

GetCapabilities returns the Capabilities field if non-nil, zero value otherwise.

### GetCapabilitiesOk

`func (o *SupportedChannel) GetCapabilitiesOk() (*map[string]interface{}, bool)`

GetCapabilitiesOk returns a tuple with the Capabilities field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCapabilities

`func (o *SupportedChannel) SetCapabilities(v map[string]interface{})`

SetCapabilities sets Capabilities field to given value.

### HasCapabilities

`func (o *SupportedChannel) HasCapabilities() bool`

HasCapabilities returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


