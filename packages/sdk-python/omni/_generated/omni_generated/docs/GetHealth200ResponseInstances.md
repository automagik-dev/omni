# GetHealth200ResponseInstances


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total** | **int** | Total instance count | 
**connected** | **int** | Connected instance count | 
**by_channel** | **Dict[str, float]** | Count by channel type | 

## Example

```python
from omni_generated.models.get_health200_response_instances import GetHealth200ResponseInstances

# TODO update the JSON string below
json = "{}"
# create an instance of GetHealth200ResponseInstances from a JSON string
get_health200_response_instances_instance = GetHealth200ResponseInstances.from_json(json)
# print the JSON string representation of the object
print(GetHealth200ResponseInstances.to_json())

# convert the object into a dict
get_health200_response_instances_dict = get_health200_response_instances_instance.to_dict()
# create an instance of GetHealth200ResponseInstances from a dict
get_health200_response_instances_from_dict = GetHealth200ResponseInstances.from_dict(get_health200_response_instances_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


