# ListSupportedChannels200ResponseItemsInner

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

### NewListSupportedChannels200ResponseItemsInner

`func NewListSupportedChannels200ResponseItemsInner(id string, name string, loaded bool, ) *ListSupportedChannels200ResponseItemsInner`

NewListSupportedChannels200ResponseItemsInner instantiates a new ListSupportedChannels200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListSupportedChannels200ResponseItemsInnerWithDefaults

`func NewListSupportedChannels200ResponseItemsInnerWithDefaults() *ListSupportedChannels200ResponseItemsInner`

NewListSupportedChannels200ResponseItemsInnerWithDefaults instantiates a new ListSupportedChannels200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ListSupportedChannels200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ListSupportedChannels200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ListSupportedChannels200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetName

`func (o *ListSupportedChannels200ResponseItemsInner) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *ListSupportedChannels200ResponseItemsInner) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *ListSupportedChannels200ResponseItemsInner) SetName(v string)`

SetName sets Name field to given value.


### GetVersion

`func (o *ListSupportedChannels200ResponseItemsInner) GetVersion() string`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *ListSupportedChannels200ResponseItemsInner) GetVersionOk() (*string, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *ListSupportedChannels200ResponseItemsInner) SetVersion(v string)`

SetVersion sets Version field to given value.

### HasVersion

`func (o *ListSupportedChannels200ResponseItemsInner) HasVersion() bool`

HasVersion returns a boolean if a field has been set.

### GetDescription

`func (o *ListSupportedChannels200ResponseItemsInner) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *ListSupportedChannels200ResponseItemsInner) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *ListSupportedChannels200ResponseItemsInner) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *ListSupportedChannels200ResponseItemsInner) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetLoaded

`func (o *ListSupportedChannels200ResponseItemsInner) GetLoaded() bool`

GetLoaded returns the Loaded field if non-nil, zero value otherwise.

### GetLoadedOk

`func (o *ListSupportedChannels200ResponseItemsInner) GetLoadedOk() (*bool, bool)`

GetLoadedOk returns a tuple with the Loaded field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLoaded

`func (o *ListSupportedChannels200ResponseItemsInner) SetLoaded(v bool)`

SetLoaded sets Loaded field to given value.


### GetCapabilities

`func (o *ListSupportedChannels200ResponseItemsInner) GetCapabilities() map[string]interface{}`

GetCapabilities returns the Capabilities field if non-nil, zero value otherwise.

### GetCapabilitiesOk

`func (o *ListSupportedChannels200ResponseItemsInner) GetCapabilitiesOk() (*map[string]interface{}, bool)`

GetCapabilitiesOk returns a tuple with the Capabilities field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCapabilities

`func (o *ListSupportedChannels200ResponseItemsInner) SetCapabilities(v map[string]interface{})`

SetCapabilities sets Capabilities field to given value.

### HasCapabilities

`func (o *ListSupportedChannels200ResponseItemsInner) HasCapabilities() bool`

HasCapabilities returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


