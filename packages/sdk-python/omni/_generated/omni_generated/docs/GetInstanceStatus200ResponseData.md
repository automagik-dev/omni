# GetInstanceStatus200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance UUID | 
**state** | **str** | Connection state | 
**is_connected** | **bool** | Whether instance is connected | 
**connected_at** | **datetime** | When connected | 
**profile_name** | **str** | Profile name | 
**profile_pic_url** | **str** | Profile picture URL | 
**owner_identifier** | **str** | Owner identifier | 
**message** | **str** | Status message | [optional] 

## Example

```python
from omni_generated.models.get_instance_status200_response_data import GetInstanceStatus200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetInstanceStatus200ResponseData from a JSON string
get_instance_status200_response_data_instance = GetInstanceStatus200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetInstanceStatus200ResponseData.to_json())

# convert the object into a dict
get_instance_status200_response_data_dict = get_instance_status200_response_data_instance.to_dict()
# create an instance of GetInstanceStatus200ResponseData from a dict
get_instance_status200_response_data_from_dict = GetInstanceStatus200ResponseData.from_dict(get_instance_status200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


